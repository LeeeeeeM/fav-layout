package models

import "time"

type User struct {
	ID           int64     `json:"id" gorm:"primaryKey;column:id"`
	Username     string    `json:"username" gorm:"column:username"`
	PasswordHash string    `json:"-" gorm:"column:password_hash"`
	CreatedAt    time.Time `json:"createdAt" gorm:"column:created_at"`
}

func (User) TableName() string {
	return "users"
}

type Session struct {
	Token     string    `gorm:"primaryKey;column:token"`
	UserID    int64     `gorm:"column:user_id"`
	ExpiresAt time.Time `gorm:"column:expires_at"`
	CreatedAt time.Time `gorm:"column:created_at"`
}

func (Session) TableName() string {
	return "sessions"
}

type StoredLayout struct {
	UserID     int64     `gorm:"primaryKey;column:user_id"`
	LayoutJSON []byte    `gorm:"column:layout_json;type:jsonb"`
	UpdatedAt  time.Time `gorm:"column:updated_at"`
}

func (StoredLayout) TableName() string {
	return "layouts"
}

type StoredLibrary struct {
	UserID      int64     `gorm:"primaryKey;column:user_id"`
	LibraryJSON []byte    `gorm:"column:library_json;type:jsonb"`
	UpdatedAt   time.Time `gorm:"column:updated_at"`
}

func (StoredLibrary) TableName() string {
	return "libraries"
}

type Widget struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	InputURL string `json:"inputUrl"`
	EmbedURL string `json:"embedUrl"`
	CoverURL string `json:"coverUrl,omitempty"`
	UpName   string `json:"upName,omitempty"`
	X        int    `json:"x"`
	Y        int    `json:"y"`
	W        int    `json:"w"`
	H        int    `json:"h"`
}

type Layout struct {
	Items     []Widget       `json:"items"`
	Mode      string         `json:"mode,omitempty"`
	SplitRoot map[string]any `json:"splitRoot,omitempty"`
}
