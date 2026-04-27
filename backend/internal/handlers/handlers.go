package handlers

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"fav-layout/backend/internal/config"
	"fav-layout/backend/internal/middleware"
	"fav-layout/backend/internal/models"
	"fav-layout/backend/internal/repository"

	"golang.org/x/crypto/bcrypt"
)

type Handler struct {
	repo       *repository.Repository
	cookieName string
	maxAgeSec  int
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

const maxJSONBodyBytes = 16 << 20

func New(repo *repository.Repository, cfg config.Config) *Handler {
	return &Handler{
		repo:       repo,
		cookieName: cfg.SessionCookie,
		maxAgeSec:  cfg.SessionMaxAgeSec,
	}
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux, auth *middleware.Auth) {
	mux.HandleFunc("GET /health", h.health)
	mux.HandleFunc("POST /api/auth/login", h.login)
	mux.HandleFunc("GET /api/bilibili/view", h.bilibiliView)
	mux.Handle("POST /api/auth/logout", auth.Require(http.HandlerFunc(h.logout)))
	mux.Handle("GET /api/auth/me", auth.Require(http.HandlerFunc(h.me)))
	mux.Handle("GET /api/layout", auth.Require(http.HandlerFunc(h.getLayout)))
	mux.Handle("GET /api/library", auth.Require(http.HandlerFunc(h.getLibrary)))
	mux.Handle("PUT /api/layout", auth.Require(http.HandlerFunc(h.saveLayout)))
	mux.Handle("PUT /api/library", auth.Require(http.HandlerFunc(h.saveLibrary)))
}

func (h *Handler) health(w http.ResponseWriter, _ *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]string{"status": "ok"})
}

// bilibiliView 代理 B 站公开接口，避免浏览器直连 api.bilibili.com 的 CORS 限制。
func (h *Handler) bilibiliView(w http.ResponseWriter, r *http.Request) {
	bvid := strings.TrimSpace(r.URL.Query().Get("bvid"))
	aid := strings.TrimSpace(r.URL.Query().Get("aid"))
	if bvid == "" && aid == "" {
		jsonError(w, http.StatusBadRequest, "bvid or aid is required")
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

	http.SetCookie(w, &http.Cookie{
		Name:     h.cookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   h.maxAgeSec,
	})

	jsonResponse(w, http.StatusOK, map[string]any{
		"user": map[string]any{
			"id":       user.ID,
			"username": user.Username,
		},
	})
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

	jsonResponse(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	user, err := middleware.UserFromContext(r.Context())
	if err != nil {
		jsonError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"user": map[string]any{
			"id":       user.ID,
			"username": user.Username,
		},
	})
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

	library, err := h.repo.GetLibrary(r.Context(), user.ID)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to load library")
		return
	}

	total := len(library)
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
	if offset > total {
		offset = total
	}

	end := offset + limit
	if end > total {
		end = total
	}
	items := library[offset:end]

	jsonResponse(w, http.StatusOK, map[string]any{
		"items":   items,
		"offset":  offset,
		"limit":   limit,
		"hasMore": end < total,
		"total":   total,
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

	if err := h.repo.SaveLayout(r.Context(), user.ID, layout); err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to save layout")
		return
	}

	jsonResponse(w, http.StatusOK, map[string]bool{"ok": true})
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

	if err := h.repo.SaveLibrary(r.Context(), user.ID, req.Items); err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to save library")
		return
	}

	jsonResponse(w, http.StatusOK, map[string]bool{"ok": true})
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
