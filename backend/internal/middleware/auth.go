package middleware

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"fav-layout/backend/internal/models"
	"fav-layout/backend/internal/repository"
)

type contextKey string

const userContextKey contextKey = "user"

type Auth struct {
	repo       *repository.Repository
	cookieName string
}

func NewAuth(repo *repository.Repository, cookieName string) *Auth {
	return &Auth{repo: repo, cookieName: cookieName}
}

func (a *Auth) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, err := r.Cookie(a.cookieName)
		if err != nil || token.Value == "" {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		user, err := a.repo.FindUserBySession(r.Context(), token.Value)
		if err != nil {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		ctx := context.WithValue(r.Context(), userContextKey, user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func UserFromContext(ctx context.Context) (models.User, error) {
	u, ok := ctx.Value(userContextKey).(models.User)
	if !ok {
		return models.User{}, errors.New("user missing in context")
	}
	return u, nil
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
