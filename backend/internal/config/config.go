package config

import "os"

type Config struct {
	Port             string
	DatabaseURL      string
	FrontendOrigin   string
	SessionCookie    string
	SessionMaxAgeSec int
	SeedUsername     string
	SeedPassword     string
}

func Load() Config {
	cfg := Config{
		Port:             getenv("PORT", "8383"),
		DatabaseURL:      getenv("DATABASE_URL", "postgres://fav:fav@localhost:5433/fav_layout?sslmode=disable"),
		FrontendOrigin:   getenv("FRONTEND_ORIGIN", "http://localhost:5173"),
		SessionCookie:    getenv("SESSION_COOKIE_NAME", "fav_session"),
		SessionMaxAgeSec: 60 * 60 * 24 * 7,
		SeedUsername:     getenv("APP_USER", "admin"),
		SeedPassword:     getenv("APP_PASSWORD", "admin123"),
	}
	return cfg
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
