package db

import (
	"fmt"

	"fav-layout/backend/internal/models"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func NewDB(databaseURL string) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(databaseURL), &gorm.Config{})
	if err != nil {
		return nil, err
	}
	return db, nil
}

func EnsureSeedUser(db *gorm.DB, username, password string) error {
	var count int64
	if err := db.Model(&models.User{}).Where("username = ?", username).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	seed := models.User{Username: username, PasswordHash: string(hash)}
	if err := db.Create(&seed).Error; err != nil {
		return fmt.Errorf("failed to create seed user: %w", err)
	}
	return nil
}
