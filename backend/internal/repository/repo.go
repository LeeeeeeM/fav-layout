package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"fav-layout/backend/internal/models"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Repository struct {
	db *gorm.DB
}

var ErrNicknameTaken = errors.New("nickname already exists")
var ErrUsernameTaken = errors.New("username already exists")
var ErrEmailTaken = errors.New("email already exists")

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

func (r *Repository) FindUserByEmail(ctx context.Context, email string) (models.User, error) {
	var u models.User
	err := r.db.WithContext(ctx).Where("LOWER(email) = LOWER(?)", email).Take(&u).Error
	if err != nil {
		return models.User{}, err
	}
	return u, nil
}

func (r *Repository) CreateUser(ctx context.Context, username, email, passwordHash, nickname string) (models.User, error) {
	user := models.User{
		Username:     username,
		Email:        email,
		PasswordHash: passwordHash,
		Nickname:     nickname,
	}
	if err := r.db.WithContext(ctx).Create(&user).Error; err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			if pgErr.ConstraintName == "users_username_key" {
				return models.User{}, ErrUsernameTaken
			}
			if pgErr.ConstraintName == "idx_users_email_unique" {
				return models.User{}, ErrEmailTaken
			}
			if pgErr.ConstraintName == "idx_users_nickname_unique" {
				return models.User{}, ErrNicknameTaken
			}
		}
		return models.User{}, err
	}
	return user, nil
}

func (r *Repository) CreateEmailVerification(ctx context.Context, v *models.EmailVerification) error {
	return r.db.WithContext(ctx).Create(v).Error
}

func (r *Repository) LastEmailVerificationCreatedAt(ctx context.Context, email, purpose string) (time.Time, bool, error) {
	var v models.EmailVerification
	err := r.db.WithContext(ctx).
		Where("email = ? AND purpose = ?", email, purpose).
		Order("id DESC").
		Take(&v).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return time.Time{}, false, nil
		}
		return time.Time{}, false, err
	}
	return v.CreatedAt, true, nil
}

func (r *Repository) FindLatestUnusedEmailVerification(ctx context.Context, email, purpose string) (models.EmailVerification, error) {
	var v models.EmailVerification
	err := r.db.WithContext(ctx).
		Where("email = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?", email, purpose, time.Now()).
		Order("id DESC").
		Take(&v).Error
	if err != nil {
		return models.EmailVerification{}, err
	}
	return v, nil
}

func (r *Repository) MarkEmailVerificationUsed(ctx context.Context, id int64) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&models.EmailVerification{}).Where("id = ?", id).Update("used_at", now).Error
}

func (r *Repository) DeleteEmailVerificationByID(ctx context.Context, id int64) error {
	return r.db.WithContext(ctx).Delete(&models.EmailVerification{}, id).Error
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
		Select("u.id, u.username, u.email, u.nickname, u.avatar_url, u.created_at").
		Joins("JOIN sessions s ON s.user_id = u.id").
		Where("s.token = ? AND s.expires_at > NOW()", token).
		Take(&u).Error
	if err != nil {
		return models.User{}, err
	}
	return u, nil
}

func (r *Repository) FindUserByID(ctx context.Context, id int64) (models.User, error) {
	var u models.User
	if err := r.db.WithContext(ctx).Where("id = ?", id).Take(&u).Error; err != nil {
		return models.User{}, err
	}
	return u, nil
}

func (r *Repository) ChangePasswordAndRotateSessions(ctx context.Context, userID int64, newPasswordHash, newToken string, newExpiresAt time.Time) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.User{}).Where("id = ?", userID).Update("password_hash", newPasswordHash).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userID).Delete(&models.Session{}).Error; err != nil {
			return err
		}
		s := models.Session{
			Token:     newToken,
			UserID:    userID,
			ExpiresAt: newExpiresAt.UTC(),
		}
		return tx.Create(&s).Error
	})
}

func (r *Repository) ResetPasswordAndDeleteSessions(ctx context.Context, userID int64, newPasswordHash string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.User{}).Where("id = ?", userID).Update("password_hash", newPasswordHash).Error; err != nil {
			return err
		}
		return tx.Where("user_id = ?", userID).Delete(&models.Session{}).Error
	})
}

func (r *Repository) UpdateUserProfile(ctx context.Context, userID int64, nickname, avatarURL string) (models.User, error) {
	var updated models.User
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.User{}).Where("id = ?", userID).Updates(map[string]any{
			"nickname":   nickname,
			"avatar_url": avatarURL,
		}).Error; err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "idx_users_nickname_unique" {
				return ErrNicknameTaken
			}
			return err
		}

		return tx.Where("id = ?", userID).Take(&updated).Error
	})
	if err != nil {
		return models.User{}, err
	}
	return updated, nil
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

	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", userID).Delete(&models.StoredLibraryItem{}).Error; err != nil {
			return err
		}

		if len(library) > 0 {
			rows := make([]models.StoredLibraryItem, 0, len(library))
			for i, widget := range library {
				payload, err := json.Marshal(widget)
				if err != nil {
					return fmt.Errorf("marshal library item %d: %w", i, err)
				}
				rows = append(rows, models.StoredLibraryItem{
					UserID:     userID,
					Position:   i,
					WidgetJSON: payload,
				})
			}
			if err := tx.CreateInBatches(rows, 200).Error; err != nil {
				return err
			}
		}

		// Keep historical aggregate row in sync for compatibility with existing data shape.
		payload, err := json.Marshal(library)
		if err != nil {
			return err
		}
		stored := models.StoredLibrary{UserID: userID, LibraryJSON: payload}
		return tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "user_id"}},
			DoUpdates: clause.Assignments(map[string]any{"library_json": payload, "updated_at": gorm.Expr("NOW()")}),
		}).Create(&stored).Error
	})
}

func (r *Repository) GetLibraryPage(ctx context.Context, userID int64, offset, limit int) ([]models.Widget, int64, error) {
	var total int64
	if err := r.db.WithContext(ctx).Model(&models.StoredLibraryItem{}).Where("user_id = ?", userID).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []models.Widget{}, 0, nil
	}

	var rows []models.StoredLibraryItem
	if err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("position ASC").
		Offset(offset).
		Limit(limit).
		Find(&rows).Error; err != nil {
		return nil, 0, err
	}

	items := make([]models.Widget, 0, len(rows))
	for i, row := range rows {
		var widget models.Widget
		if err := json.Unmarshal(row.WidgetJSON, &widget); err != nil {
			return nil, 0, fmt.Errorf("unmarshal library item row %d: %w", i, err)
		}
		items = append(items, widget)
	}
	return items, total, nil
}

func (r *Repository) CleanupExpiredSessions(ctx context.Context) error {
	return r.db.WithContext(ctx).Where("expires_at <= NOW()").Delete(&models.Session{}).Error
}
