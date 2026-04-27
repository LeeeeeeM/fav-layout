package migrations

import (
	"embed"
	"fmt"
	"sort"

	"gorm.io/gorm"
)

//go:embed *.sql
var files embed.FS

func Apply(db *gorm.DB) error {
	entries, err := files.ReadDir(".")
	if err != nil {
		return err
	}

	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		names = append(names, entry.Name())
	}
	sort.Strings(names)

	for _, name := range names {
		content, readErr := files.ReadFile(name)
		if readErr != nil {
			return readErr
		}
		if execErr := db.Exec(string(content)).Error; execErr != nil {
			return fmt.Errorf("apply migration %s: %w", name, execErr)
		}
	}

	return nil
}
