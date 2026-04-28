package config

import "os"

type Config struct {
	Port             string
	DatabaseURL      string
	SessionCookie    string
	SessionMaxAgeSec int
	ResendAPIKey     string
	ResendFromEmail  string
}

func Load() Config {
	databaseURL := getenv("DATABASE_URL", "")
	if databaseURL == "" {
		dbHost := getenv("DB_HOST", "localhost")
		dbPort := getenv("DB_PORT", "5433")
		dbUser := getenv("DB_USER", "fav")
		dbPassword := getenv("DB_PASSWORD", "fav")
		dbName := getenv("DB_NAME", "fav_layout")
		dbSSLMode := getenv("DB_SSLMODE", "disable")
		databaseURL = "postgres://" + dbUser + ":" + dbPassword + "@" + dbHost + ":" + dbPort + "/" + dbName + "?sslmode=" + dbSSLMode
	}

	cfg := Config{
		Port:             getenv("PORT", "8383"),
		DatabaseURL:      databaseURL,
		SessionCookie:    getenv("SESSION_COOKIE_NAME", "fav_session"),
		SessionMaxAgeSec: 60 * 60 * 24 * 7,
		ResendAPIKey:     getenv("RESEND_API_KEY", ""),
		ResendFromEmail:  getenv("RESEND_FROM_EMAIL", ""),
	}
	return cfg
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
