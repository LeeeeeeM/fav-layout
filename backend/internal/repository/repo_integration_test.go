package repository

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"fav-layout/backend/internal/db"
	"fav-layout/backend/internal/models"
	"fav-layout/backend/migrations"
)

func TestRepositoryLibraryPagingIntegration(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set; skipping integration test")
	}

	gormDB, err := db.NewDB(databaseURL)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := migrations.Apply(gormDB); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}

	ctx := context.Background()
	repo := New(gormDB)

	username := fmt.Sprintf("it_repo_%d", time.Now().UnixNano())
	user := models.User{
		Username:     username,
		PasswordHash: "integration-test-hash",
		Nickname:     username,
	}
	if err := gormDB.WithContext(ctx).Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		_ = gormDB.WithContext(context.Background()).Where("id = ?", user.ID).Delete(&models.User{}).Error
	})

	all := []models.Widget{
		{ID: "w1", Title: "One", InputURL: "u1", EmbedURL: "e1", X: 0, Y: 0, W: 1, H: 1},
		{ID: "w2", Title: "Two", InputURL: "u2", EmbedURL: "e2", X: 1, Y: 0, W: 1, H: 1},
		{ID: "w3", Title: "Three", InputURL: "u3", EmbedURL: "e3", X: 2, Y: 0, W: 1, H: 1},
		{ID: "w4", Title: "Four", InputURL: "u4", EmbedURL: "e4", X: 3, Y: 0, W: 1, H: 1},
	}

	if err := repo.SaveLibrary(ctx, user.ID, all); err != nil {
		t.Fatalf("save library: %v", err)
	}

	t.Run("first page", func(t *testing.T) {
		items, total, err := repo.GetLibraryPage(ctx, user.ID, 0, 2)
		if err != nil {
			t.Fatalf("get first page: %v", err)
		}
		if total != 4 {
			t.Fatalf("unexpected total: got %d want 4", total)
		}
		if len(items) != 2 {
			t.Fatalf("unexpected items length: got %d want 2", len(items))
		}
		if items[0].ID != "w1" || items[1].ID != "w2" {
			t.Fatalf("unexpected page order: got [%s,%s]", items[0].ID, items[1].ID)
		}
	})

	t.Run("middle page", func(t *testing.T) {
		items, total, err := repo.GetLibraryPage(ctx, user.ID, 2, 2)
		if err != nil {
			t.Fatalf("get middle page: %v", err)
		}
		if total != 4 {
			t.Fatalf("unexpected total: got %d want 4", total)
		}
		if len(items) != 2 {
			t.Fatalf("unexpected items length: got %d want 2", len(items))
		}
		if items[0].ID != "w3" || items[1].ID != "w4" {
			t.Fatalf("unexpected page order: got [%s,%s]", items[0].ID, items[1].ID)
		}
	})

	t.Run("offset beyond total", func(t *testing.T) {
		items, total, err := repo.GetLibraryPage(ctx, user.ID, 9, 2)
		if err != nil {
			t.Fatalf("get overflow page: %v", err)
		}
		if total != 4 {
			t.Fatalf("unexpected total: got %d want 4", total)
		}
		if len(items) != 0 {
			t.Fatalf("unexpected items length: got %d want 0", len(items))
		}
	})
}

func TestRepositoryLibraryPagingEmptyIntegration(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set; skipping integration test")
	}

	gormDB, err := db.NewDB(databaseURL)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := migrations.Apply(gormDB); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}

	ctx := context.Background()
	repo := New(gormDB)

	username := fmt.Sprintf("it_empty_%d", time.Now().UnixNano())
	user := models.User{
		Username:     username,
		PasswordHash: "integration-test-hash",
		Nickname:     username,
	}
	if err := gormDB.WithContext(ctx).Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		_ = gormDB.WithContext(context.Background()).Where("id = ?", user.ID).Delete(&models.User{}).Error
	})

	if err := repo.SaveLibrary(ctx, user.ID, nil); err != nil {
		t.Fatalf("save empty library: %v", err)
	}

	items, total, err := repo.GetLibraryPage(ctx, user.ID, 0, 10)
	if err != nil {
		t.Fatalf("get empty page: %v", err)
	}
	if total != 0 {
		t.Fatalf("unexpected total: got %d want 0", total)
	}
	if len(items) != 0 {
		t.Fatalf("unexpected items length: got %d want 0", len(items))
	}
}
