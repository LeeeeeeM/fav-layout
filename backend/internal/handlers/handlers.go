package handlers

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"fav-layout/backend/internal/config"
	"fav-layout/backend/internal/middleware"
	"fav-layout/backend/internal/models"
	"fav-layout/backend/internal/repository"
	"fav-layout/backend/internal/service"

	"github.com/resend/resend-go/v3"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type Handler struct {
	repo       *repository.Repository
	cookieName string
	maxAgeSec  int
	resendKey  string
	resendFrom string
	captchaSvc *service.CaptchaService
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type registerRequest struct {
	Username         string `json:"username"`
	Email            string `json:"email"`
	Password         string `json:"password"`
	Nickname         string `json:"nickname"`
	VerificationCode string `json:"verificationCode"`
}

type updateProfileRequest struct {
	Nickname  string `json:"nickname"`
	AvatarURL string `json:"avatarUrl"`
}

type userResponse struct {
	User map[string]any `json:"user"`
}

type okResponse struct {
	OK bool `json:"ok"`
}

type libraryPageResponse struct {
	Items   []models.Widget `json:"items"`
	Offset  int             `json:"offset"`
	Limit   int             `json:"limit"`
	HasMore bool            `json:"hasMore"`
	Total   int             `json:"total"`
}

type sendRegisterVerificationCodeRequest struct {
	Email       string `json:"email"`
	CaptchaID   string `json:"captchaId"`
	CaptchaCode string `json:"captchaCode"`
}

type captchaResponse struct {
	CaptchaID    string `json:"captchaId"`
	ImageBase64  string `json:"imageBase64"`
	ImageDataURL string `json:"imageDataUrl"`
}

const (
	maxJSONBodyBytes = 16 << 20
	maxLayoutItems   = 500
	maxLibraryItems  = 2000
	codeTTL          = 10 * time.Minute
	sendCooldown     = 60 * time.Second
	purposeRegister  = "register"
)

var (
	bvidPattern = regexp.MustCompile(`^BV[0-9A-Za-z]{10}$`)
	aidPattern  = regexp.MustCompile(`^\d+$`)
)

func New(repo *repository.Repository, cfg config.Config) *Handler {
	return &Handler{
		repo:       repo,
		cookieName: cfg.SessionCookie,
		maxAgeSec:  cfg.SessionMaxAgeSec,
		resendKey:  cfg.ResendAPIKey,
		resendFrom: cfg.ResendFromEmail,
		captchaSvc: service.NewCaptchaService(),
	}
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux, auth *middleware.Auth) {
	mux.HandleFunc("GET /health", h.health)
	mux.HandleFunc("POST /api/auth/login", h.login)
	mux.HandleFunc("POST /api/auth/register", h.register)
	mux.HandleFunc("GET /api/auth/captcha", h.getCaptcha)
	mux.HandleFunc("POST /api/auth/email-verification/register", h.sendRegisterVerificationCode)
	mux.HandleFunc("GET /api/bilibili/view", h.bilibiliView)
	mux.Handle("POST /api/auth/logout", auth.Require(http.HandlerFunc(h.logout)))
	mux.Handle("GET /api/auth/me", auth.Require(http.HandlerFunc(h.me)))
	mux.Handle("GET /api/profile", auth.Require(http.HandlerFunc(h.getProfile)))
	mux.Handle("PUT /api/profile", auth.Require(http.HandlerFunc(h.updateProfile)))
	mux.Handle("GET /api/layout", auth.Require(http.HandlerFunc(h.getLayout)))
	mux.Handle("GET /api/library", auth.Require(http.HandlerFunc(h.getLibrary)))
	mux.Handle("PUT /api/layout", auth.Require(http.HandlerFunc(h.saveLayout)))
	mux.Handle("PUT /api/library", auth.Require(http.HandlerFunc(h.saveLibrary)))
}

func (h *Handler) health(w http.ResponseWriter, _ *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) getCaptcha(w http.ResponseWriter, _ *http.Request) {
	id, imageBase64, err := h.captchaSvc.Generate()
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to generate captcha")
		return
	}
	imageDataURL := imageBase64
	if !strings.HasPrefix(imageDataURL, "data:image/") {
		imageDataURL = "data:image/png;base64," + imageBase64
	} else {
		if idx := strings.Index(imageDataURL, ","); idx > 0 {
			imageBase64 = imageDataURL[idx+1:]
		}
	}
	jsonResponse(w, http.StatusOK, captchaResponse{
		CaptchaID:    id,
		ImageBase64:  imageBase64,
		ImageDataURL: imageDataURL,
	})
}

// bilibiliView 代理 B 站公开接口，避免浏览器直连 api.bilibili.com 的 CORS 限制。
func (h *Handler) bilibiliView(w http.ResponseWriter, r *http.Request) {
	bvid := strings.TrimSpace(r.URL.Query().Get("bvid"))
	aid := strings.TrimSpace(r.URL.Query().Get("aid"))
	if bvid == "" && aid == "" {
		jsonError(w, http.StatusBadRequest, "bvid or aid is required")
		return
	}
	if bvid != "" && !bvidPattern.MatchString(bvid) {
		jsonError(w, http.StatusBadRequest, "invalid bvid")
		return
	}
	if aid != "" && !aidPattern.MatchString(aid) {
		jsonError(w, http.StatusBadRequest, "invalid aid")
		return
	}

	apiURL, err := url.Parse("https://api.bilibili.com/x/web-interface/view")
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "invalid upstream URL")
		return
	}
	q := apiURL.Query()
	if bvid != "" {
		q.Set("bvid", bvid)
	} else {
		q.Set("aid", aid)
	}
	apiURL.RawQuery = q.Encode()

	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL.String(), nil)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to build request")
		return
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; fav-layout/1.0; +local-dev)")
	req.Header.Set("Referer", "https://www.bilibili.com/")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		jsonError(w, http.StatusBadGateway, "upstream request failed")
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		jsonError(w, http.StatusBadGateway, "failed to read upstream")
		return
	}

	var wrapper struct {
		Code int `json:"code"`
		Data *struct {
			Title string `json:"title"`
			Pic   string `json:"pic"`
			Owner *struct {
				Name string `json:"name"`
			} `json:"owner"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &wrapper); err != nil || wrapper.Data == nil {
		jsonError(w, http.StatusBadGateway, "invalid upstream response")
		return
	}
	if wrapper.Code != 0 {
		jsonError(w, http.StatusBadGateway, "bilibili API returned an error")
		return
	}

	out := map[string]any{
		"title": strings.TrimSpace(wrapper.Data.Title),
		"pic":   strings.TrimSpace(wrapper.Data.Pic),
	}
	if wrapper.Data.Owner != nil {
		if n := strings.TrimSpace(wrapper.Data.Owner.Name); n != "" {
			out["upName"] = n
		}
	}

	jsonResponse(w, http.StatusOK, out)
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := decodeJSONBody(w, r, &req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" || req.Password == "" {
		jsonError(w, http.StatusBadRequest, "username and password are required")
		return
	}

	user, err := h.repo.FindUserByUsername(r.Context(), req.Username)
	if err != nil {
		jsonError(w, http.StatusUnauthorized, "invalid username or password")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		jsonError(w, http.StatusUnauthorized, "invalid username or password")
		return
	}

	token, err := genSessionToken()
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to create session")
		return
	}

	expiresAt := time.Now().Add(time.Duration(h.maxAgeSec) * time.Second)
	if err := h.repo.CreateSession(r.Context(), token, user.ID, expiresAt); err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to save session")
		return
	}
	h.writeSessionCookie(w, token)
	jsonResponse(w, http.StatusOK, userResponse{User: mapUser(user)})
}

func (h *Handler) register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := decodeJSONBody(w, r, &req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	username := strings.TrimSpace(req.Username)
	email := strings.TrimSpace(strings.ToLower(req.Email))
	nickname := strings.TrimSpace(req.Nickname)
	password := req.Password
	code := strings.TrimSpace(req.VerificationCode)
	if username == "" || email == "" || password == "" || code == "" {
		jsonError(w, http.StatusBadRequest, "username, email, password and verificationCode are required")
		return
	}
	if nickname == "" {
		nickname = username
	}
	if !isValidEmail(email) {
		jsonError(w, http.StatusBadRequest, "invalid email")
		return
	}
	if len(password) < 6 {
		jsonError(w, http.StatusBadRequest, "password must be at least 6 characters")
		return
	}
	if err := h.verifyAndConsumeCode(r.Context(), email, purposeRegister, code); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid or expired verification code")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to create user")
		return
	}
	user, err := h.repo.CreateUser(r.Context(), username, email, string(hash), nickname)
	if err != nil {
		if err == repository.ErrUsernameTaken {
			jsonError(w, http.StatusConflict, "username already exists")
			return
		}
		if err == repository.ErrEmailTaken {
			jsonError(w, http.StatusConflict, "email already exists")
			return
		}
		if err == repository.ErrNicknameTaken {
			jsonError(w, http.StatusConflict, "nickname already exists")
			return
		}
		jsonError(w, http.StatusInternalServerError, "failed to create user")
		return
	}

	token, err := genSessionToken()
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to create session")
		return
	}
	expiresAt := time.Now().Add(time.Duration(h.maxAgeSec) * time.Second)
	if err := h.repo.CreateSession(r.Context(), token, user.ID, expiresAt); err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to save session")
		return
	}
	h.writeSessionCookie(w, token)
	jsonResponse(w, http.StatusOK, userResponse{User: mapUser(user)})
}

func (h *Handler) sendRegisterVerificationCode(w http.ResponseWriter, r *http.Request) {
	var req sendRegisterVerificationCodeRequest
	if err := decodeJSONBody(w, r, &req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	email := strings.TrimSpace(strings.ToLower(req.Email))
	if email == "" {
		jsonError(w, http.StatusBadRequest, "email is required")
		return
	}
	if !isValidEmail(email) {
		jsonError(w, http.StatusBadRequest, "invalid email")
		return
	}
	if !h.mailConfigured() {
		jsonError(w, http.StatusServiceUnavailable, "mail service unavailable: missing RESEND_API_KEY or RESEND_FROM_EMAIL")
		return
	}
	if strings.TrimSpace(req.CaptchaID) == "" || strings.TrimSpace(req.CaptchaCode) == "" {
		jsonError(w, http.StatusBadRequest, "captchaId and captchaCode are required")
		return
	}
	if err := h.captchaSvc.VerifyAndConsume(req.CaptchaID, req.CaptchaCode); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid captcha")
		return
	}

	if _, err := h.repo.FindUserByEmail(r.Context(), email); err == nil {
		jsonError(w, http.StatusConflict, "email already exists")
		return
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		jsonError(w, http.StatusInternalServerError, "failed to check email")
		return
	}

	lastAt, ok, err := h.repo.LastEmailVerificationCreatedAt(r.Context(), email, purposeRegister)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to send verification code")
		return
	}
	if ok && time.Since(lastAt) < sendCooldown {
		wait := sendCooldown - time.Since(lastAt)
		sec := int(wait.Seconds()) + 1
		if sec < 1 {
			sec = 1
		}
		jsonError(w, http.StatusTooManyRequests, fmt.Sprintf("too many requests, retry after %d seconds", sec))
		return
	}

	plain, err := randomDigits(6)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to generate verification code")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to send verification code")
		return
	}
	rec := &models.EmailVerification{
		Email:     email,
		Purpose:   purposeRegister,
		CodeHash:  string(hash),
		ExpiresAt: time.Now().Add(codeTTL),
	}
	if err := h.repo.CreateEmailVerification(r.Context(), rec); err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to send verification code")
		return
	}

	html := fmt.Sprintf(
		"<p>您正在注册账号，验证码为：</p><p style=\"font-size:24px;font-weight:bold;letter-spacing:4px;\">%s</p><p>验证码 %d 分钟内有效，请勿泄露给他人。</p>",
		plain, int(codeTTL.Minutes()),
	)
	if err := h.sendMailHTML([]string{email}, "注册验证码", html); err != nil {
		_ = h.repo.DeleteEmailVerificationByID(r.Context(), rec.ID)
		jsonError(w, http.StatusServiceUnavailable, "mail service unavailable")
		return
	}
	jsonResponse(w, http.StatusOK, okResponse{OK: true})
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(h.cookieName)
	if err == nil && cookie.Value != "" {
		_ = h.repo.DeleteSession(r.Context(), cookie.Value)
	}

	http.SetCookie(w, &http.Cookie{
		Name:     h.cookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})

	jsonResponse(w, http.StatusOK, okResponse{OK: true})
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	h.getProfile(w, r)
}

func (h *Handler) getProfile(w http.ResponseWriter, r *http.Request) {
	user, err := middleware.UserFromContext(r.Context())
	if err != nil {
		jsonError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	jsonResponse(w, http.StatusOK, userResponse{User: mapUser(user)})
}

func (h *Handler) updateProfile(w http.ResponseWriter, r *http.Request) {
	user, err := middleware.UserFromContext(r.Context())
	if err != nil {
		jsonError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req updateProfileRequest
	if err := decodeJSONBody(w, r, &req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	nickname := strings.TrimSpace(req.Nickname)
	if nickname == "" {
		jsonError(w, http.StatusBadRequest, "nickname is required")
		return
	}

	avatarURL := strings.TrimSpace(req.AvatarURL)
	if avatarURL != "" {
		parsed, err := url.ParseRequestURI(avatarURL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			jsonError(w, http.StatusBadRequest, "avatarUrl must be a valid http/https URL")
			return
		}
	}

	updated, err := h.repo.UpdateUserProfile(r.Context(), user.ID, nickname, avatarURL)
	if err != nil {
		if err == repository.ErrNicknameTaken {
			jsonError(w, http.StatusConflict, "nickname already exists")
			return
		}
		jsonError(w, http.StatusInternalServerError, "failed to update profile")
		return
	}
	jsonResponse(w, http.StatusOK, userResponse{User: mapUser(updated)})
}

func (h *Handler) getLayout(w http.ResponseWriter, r *http.Request) {
	user, err := middleware.UserFromContext(r.Context())
	if err != nil {
		jsonError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	layout, err := h.repo.GetLayout(r.Context(), user.ID)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to load layout")
		return
	}

	jsonResponse(w, http.StatusOK, layout)
}

func (h *Handler) getLibrary(w http.ResponseWriter, r *http.Request) {
	user, err := middleware.UserFromContext(r.Context())
	if err != nil {
		jsonError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	offset := parseIntQuery(r, "offset", 0)
	limit := parseIntQuery(r, "limit", 10)
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 {
		limit = 10
	}
	if limit > 50 {
		limit = 50
	}
	items, total64, err := h.repo.GetLibraryPage(r.Context(), user.ID, offset, limit)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to load library")
		return
	}
	total := int(total64)
	if offset > total {
		offset = total
		items = []models.Widget{}
	}
	end := offset + len(items)

	jsonResponse(w, http.StatusOK, libraryPageResponse{
		Items:   items,
		Offset:  offset,
		Limit:   limit,
		HasMore: end < total,
		Total:   total,
	})
}

func (h *Handler) saveLayout(w http.ResponseWriter, r *http.Request) {
	user, err := middleware.UserFromContext(r.Context())
	if err != nil {
		jsonError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var layout models.Layout
	if err := decodeJSONBody(w, r, &layout); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if layout.Items == nil {
		layout.Items = []models.Widget{}
	}
	if len(layout.Items) > maxLayoutItems {
		jsonError(w, http.StatusBadRequest, "too many layout items")
		return
	}

	if err := h.repo.SaveLayout(r.Context(), user.ID, layout); err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to save layout")
		return
	}

	jsonResponse(w, http.StatusOK, okResponse{OK: true})
}

func (h *Handler) saveLibrary(w http.ResponseWriter, r *http.Request) {
	user, err := middleware.UserFromContext(r.Context())
	if err != nil {
		jsonError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req struct {
		Items []models.Widget `json:"items"`
	}
	if err := decodeJSONBody(w, r, &req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Items == nil {
		req.Items = []models.Widget{}
	}
	if len(req.Items) > maxLibraryItems {
		jsonError(w, http.StatusBadRequest, "too many library items")
		return
	}

	if err := h.repo.SaveLibrary(r.Context(), user.ID, req.Items); err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to save library")
		return
	}

	jsonResponse(w, http.StatusOK, okResponse{OK: true})
}

func genSessionToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func parseIntQuery(r *http.Request, key string, defaultValue int) int {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return defaultValue
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return defaultValue
	}
	return n
}

func jsonResponse(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func jsonError(w http.ResponseWriter, status int, message string) {
	jsonResponse(w, status, map[string]string{"error": message})
}

func mapUser(user models.User) map[string]any {
	return map[string]any{
		"id":        user.ID,
		"username":  user.Username,
		"email":     strings.TrimSpace(user.Email),
		"nickname":  strings.TrimSpace(user.Nickname),
		"avatarUrl": strings.TrimSpace(user.AvatarURL),
	}
}

func (h *Handler) writeSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     h.cookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   h.maxAgeSec,
	})
}

func isValidEmail(email string) bool {
	at := strings.IndexByte(email, '@')
	if at <= 0 || at >= len(email)-1 {
		return false
	}
	dot := strings.LastIndex(email, ".")
	return dot > at+1 && dot < len(email)-1
}

func randomDigits(n int) (string, error) {
	const digits = "0123456789"
	b := make([]byte, n)
	for i := range b {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(digits))))
		if err != nil {
			return "", err
		}
		b[i] = digits[idx.Int64()]
	}
	return string(b), nil
}

func (h *Handler) verifyAndConsumeCode(ctx context.Context, email, purpose, plainCode string) error {
	v, err := h.repo.FindLatestUnusedEmailVerification(ctx, email, purpose)
	if err != nil {
		return err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(v.CodeHash), []byte(plainCode)); err != nil {
		return err
	}
	return h.repo.MarkEmailVerificationUsed(ctx, v.ID)
}

func (h *Handler) mailConfigured() bool {
	return h.resendKey != "" && h.resendFrom != ""
}

func (h *Handler) sendMailHTML(to []string, subject, html string) error {
	client := resend.NewClient(h.resendKey)
	_, err := client.Emails.Send(&resend.SendEmailRequest{
		From:    h.resendFrom,
		To:      to,
		Subject: subject,
		Html:    html,
	})
	return err
}

func decodeJSONBody(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return err
	}
	return nil
}
