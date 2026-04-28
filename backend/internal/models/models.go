package models

import "time"

type User struct {
	ID           int64     `json:"id" gorm:"primaryKey;column:id"`
	Username     string    `json:"username" gorm:"column:username"`
	Email        string    `json:"email" gorm:"column:email"`
	Nickname     string    `json:"nickname" gorm:"column:nickname"`
	AvatarURL    string    `json:"avatarUrl" gorm:"column:avatar_url"`
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

type StoredLibraryItem struct {
	ID         int64     `gorm:"primaryKey;column:id"`
	UserID     int64     `gorm:"column:user_id"`
	Position   int       `gorm:"column:position"`
	WidgetJSON []byte    `gorm:"column:widget_json;type:jsonb"`
	CreatedAt  time.Time `gorm:"column:created_at"`
	UpdatedAt  time.Time `gorm:"column:updated_at"`
}

func (StoredLibraryItem) TableName() string {
	return "library_items"
}

type EmailVerification struct {
	ID        int64      `gorm:"primaryKey;column:id"`
	Email     string     `gorm:"column:email"`
	Purpose   string     `gorm:"column:purpose"`
	CodeHash  string     `gorm:"column:code_hash"`
	ExpiresAt time.Time  `gorm:"column:expires_at"`
	UsedAt    *time.Time `gorm:"column:used_at"`
	CreatedAt time.Time  `gorm:"column:created_at"`
}

func (EmailVerification) TableName() string {
	return "email_verifications"
}

type Widget struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	InputURL    string   `json:"inputUrl"`
	EmbedURL    string   `json:"embedUrl"`
	CoverURL    string   `json:"coverUrl,omitempty"`
	UpName      string   `json:"upName,omitempty"`
	AspectRatio *float64 `json:"aspectRatio,omitempty"`
	X           int      `json:"x"`
	Y           int      `json:"y"`
	W           int      `json:"w"`
	H           int      `json:"h"`
}

type Layout struct {
	Items     []Widget       `json:"items"`
	Mode      string         `json:"mode,omitempty"`
	SplitRoot map[string]any `json:"splitRoot,omitempty"`
}
