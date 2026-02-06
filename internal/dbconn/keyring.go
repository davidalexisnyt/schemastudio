package dbconn

import (
	"github.com/zalando/go-keyring"
)

const keyringService = "schemastudio"

// SavePassword stores a password in the OS credential manager for the given profile name.
func SavePassword(profileName string, password string) error {
	return keyring.Set(keyringService, profileName, password)
}

// LoadPassword retrieves a stored password from the OS credential manager.
func LoadPassword(profileName string) (string, error) {
	return keyring.Get(keyringService, profileName)
}

// DeletePassword removes a stored password from the OS credential manager.
func DeletePassword(profileName string) error {
	return keyring.Delete(keyringService, profileName)
}
