package repository

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"fav-layout/backend/internal/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Repository struct {
	db *gorm.DB
}

func New(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) FindUserByUsername(ctx context.Context, username string) (models.User, error) {
	var u models.User
	err := r.db.WithContext(ctx).Where("username = ?", username).Take(&u).Error
	if err != nil {
		return models.User{}, err
	}
	return u, nil
}

func (r *Repository) CreateSession(ctx context.Context, token string, userID int64, expiresAt time.Time) error {
	s := models.Session{
		Token:     token,
		UserID:    userID,
		ExpiresAt: expiresAt.UTC(),
	}
	return r.db.WithContext(ctx).Create(&s).Error
}

func (r *Repository) DeleteSession(ctx context.Context, token string) error {
	return r.db.WithContext(ctx).Where("token = ?", token).Delete(&models.Session{}).Error
}

func (r *Repository) FindUserBySession(ctx context.Context, token string) (models.User, error) {
	var u models.User
	err := r.db.WithContext(ctx).
		Table("users u").
		Select("u.id, u.username, u.password_hash, u.created_at").
		Joins("JOIN sessions s ON s.user_id = u.id").
		Where("s.token = ? AND s.expires_at > NOW()", token).
		Take(&u).Error
	if err != nil {
		return models.User{}, err
	}
	return u, nil
}

func (r *Repository) SaveLayout(ctx context.Context, userID int64, layout models.Layout) error {
	if layout.Items == nil {
		layout.Items = []models.Widget{}
	}
	payload, err := json.Marshal(layout)
	if err != nil {
		return err
	}

	stored := models.StoredLayout{UserID: userID, LayoutJSON: payload}
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "user_id"}},
			DoUpdates: clause.Assignments(map[string]any{"layout_json": payload, "updated_at": gorm.Expr("NOW()")}),
		}).
		Create(&stored).Error
}

func (r *Repository) GetLayout(ctx context.Context, userID int64) (models.Layout, error) {
	var stored models.StoredLayout
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Take(&stored).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return models.Layout{Items: []models.Widget{}}, nil
		}
		return models.Layout{}, err
	}

	var layout models.Layout
	if err := json.Unmarshal(stored.LayoutJSON, &layout); err != nil {
		return models.Layout{}, err
	}
	if layout.Items == nil {
		layout.Items = []models.Widget{}
	}
	return layout, nil
}

func (r *Repository) SaveLibrary(ctx context.Context, userID int64, library []models.Widget) error {
	if library == nil {
		library = []models.Widget{}
	}
	payload, err := json.Marshal(library)
	if err != nil {
		return err
	}

	stored := models.StoredLibrary{UserID: userID, LibraryJSON: payload}
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "user_id"}},
			DoUpdates: clause.Assignments(map[string]any{"library_json": payload, "updated_at": gorm.Expr("NOW()")}),
		}).
		Create(&stored).Error
}

func (r *Repository) GetLibrary(ctx context.Context, userID int64) ([]models.Widget, error) {
	var stored models.StoredLibrary
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Take(&stored).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return []models.Widget{}, nil
		}
		return nil, err
	}

	var library []models.Widget
	if err := json.Unmarshal(stored.LibraryJSON, &library); err != nil {
		return nil, err
	}
	if library == nil {
		library = []models.Widget{}
	}
	return library, nil
}

func (r *Repository) CleanupExpiredSessions(ctx context.Context) error {
	return r.db.WithContext(ctx).Where("expires_at <= NOW()").Delete(&models.Session{}).Error
}
