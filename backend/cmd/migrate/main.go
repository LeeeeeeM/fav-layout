package main

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"

	"fav-layout/backend/internal/config"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

func main() {
	cfg := config.Load()

	migrationDir := os.Getenv("MIGRATION_DIR")
	if migrationDir == "" {
		migrationDir = "migration"
	}
	absDir, err := filepath.Abs(migrationDir)
	if err != nil {
		log.Fatalf("resolve migration dir failed: %v", err)
	}
	sourceURL := "file://" + absDir

	m, err := migrate.New(sourceURL, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("create migrator failed: %v", err)
	}
	defer func() {
		_, _ = m.Close()
	}()

	if len(os.Args) < 2 {
		usageAndExit()
	}

	cmd := os.Args[1]
	switch cmd {
	case "up":
		if len(os.Args) == 3 {
			steps, convErr := strconv.Atoi(os.Args[2])
			if convErr != nil {
				log.Fatalf("invalid steps: %v", convErr)
			}
			err = m.Steps(steps)
		} else {
			err = m.Up()
		}
	case "down":
		if len(os.Args) == 3 {
			steps, convErr := strconv.Atoi(os.Args[2])
			if convErr != nil {
				log.Fatalf("invalid steps: %v", convErr)
			}
			err = m.Steps(-steps)
		} else {
			err = m.Steps(-1)
		}
	case "version":
		v, dirty, verErr := m.Version()
		if verErr != nil {
			if errors.Is(verErr, migrate.ErrNilVersion) {
				fmt.Println("version: nil (no migrations applied)")
				return
			}
			log.Fatalf("read version failed: %v", verErr)
		}
		fmt.Printf("version: %d dirty: %v\n", v, dirty)
		return
	case "force":
		if len(os.Args) != 3 {
			log.Fatal("force requires version number")
		}
		v, convErr := strconv.Atoi(os.Args[2])
		if convErr != nil {
			log.Fatalf("invalid version: %v", convErr)
		}
		err = m.Force(v)
	default:
		usageAndExit()
	}

	if err != nil && !errors.Is(err, migrate.ErrNoChange) {
		log.Fatalf("migration command failed: %v", err)
	}
	if errors.Is(err, migrate.ErrNoChange) {
		fmt.Println("no change")
		return
	}
	fmt.Println("ok")
}

func usageAndExit() {
	fmt.Println("usage:")
	fmt.Println("  go run ./cmd/migrate up [steps]")
	fmt.Println("  go run ./cmd/migrate down [steps]")
	fmt.Println("  go run ./cmd/migrate version")
	fmt.Println("  go run ./cmd/migrate force <version>")
	os.Exit(1)
}
