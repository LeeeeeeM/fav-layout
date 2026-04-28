package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"fav-layout/backend/internal/config"
	"fav-layout/backend/internal/db"
	"fav-layout/backend/internal/handlers"
	"fav-layout/backend/internal/middleware"
	"fav-layout/backend/internal/repository"
	"fav-layout/backend/migrations"

	"github.com/go-chi/chi/v5"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()
	_ = godotenv.Load("backend/.env")
	cfg := config.Load()

	gormDB, err := db.NewDB(cfg.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}

	if err := migrations.Apply(gormDB); err != nil {
		log.Fatal(err)
	}

	repo := repository.New(gormDB)
	if err := repo.CleanupExpiredSessions(context.Background()); err != nil {
		log.Printf("cleanup sessions warning: %v", err)
	}

	h := handlers.New(repo, cfg)
	auth := middleware.NewAuth(repo, cfg.SessionCookie)

	r := chi.NewRouter()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux, auth)
	r.Mount("/", mux)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Printf("backend listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-sigCh:
		log.Printf("received signal: %s", sig)
	case err := <-errCh:
		log.Fatal(err)
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("graceful shutdown error: %v", err)
	}
}
