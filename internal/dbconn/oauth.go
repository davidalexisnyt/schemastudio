package dbconn

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

// BigQuery OAuth2 scopes.
var bigqueryScopes = []string{
	"https://www.googleapis.com/auth/bigquery.readonly",
}

// OAuthClientConfig holds the OAuth2 client ID and secret.
// These can be embedded in the application or provided by the user.
type OAuthClientConfig struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
}

// DefaultOAuthConfig returns the default OAuth2 configuration for BigQuery.
// In production, the client ID/secret should be embedded or configured.
// Users can override by providing their own client_secrets.json.
func DefaultOAuthConfig(clientID, clientSecret string) *oauth2.Config {
	return &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		Endpoint:     google.Endpoint,
		Scopes:       bigqueryScopes,
	}
}

// StartOAuthFlow initiates the OAuth2 authorization code flow.
// It starts a temporary localhost HTTP server, returns the authorization URL
// that should be opened in a browser/webview, and waits for the callback.
// Returns the obtained token.
func StartOAuthFlow(clientID, clientSecret string) (authURL string, waitForToken func() (*oauth2.Token, error), cleanup func(), err error) {
	oauthCfg := DefaultOAuthConfig(clientID, clientSecret)

	// Listen on a random port on localhost only
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", nil, nil, fmt.Errorf("starting oauth listener: %w", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	oauthCfg.RedirectURL = fmt.Sprintf("http://localhost:%d/callback", port)

	// Generate a state parameter for CSRF protection
	state := fmt.Sprintf("schemastudio-%d", time.Now().UnixNano())
	authURL = oauthCfg.AuthCodeURL(state, oauth2.AccessTypeOffline)

	// Channel to receive the authorization code
	codeCh := make(chan string, 1)
	errCh := make(chan error, 1)

	mux := http.NewServeMux()
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("state") != state {
			errCh <- fmt.Errorf("oauth state mismatch")
			http.Error(w, "State mismatch", http.StatusBadRequest)
			return
		}
		if errStr := r.URL.Query().Get("error"); errStr != "" {
			errCh <- fmt.Errorf("oauth error: %s", errStr)
			fmt.Fprintf(w, "<html><body><h2>Authentication failed: %s</h2><p>You can close this window.</p></body></html>", errStr)
			return
		}
		code := r.URL.Query().Get("code")
		if code == "" {
			errCh <- fmt.Errorf("no authorization code received")
			http.Error(w, "No code", http.StatusBadRequest)
			return
		}
		codeCh <- code
		fmt.Fprint(w, "<html><body><h2>Authentication successful!</h2><p>You can close this window.</p><script>window.close();</script></body></html>")
	})

	server := &http.Server{Handler: mux}
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		server.Serve(listener)
	}()

	cleanup = func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(ctx)
		wg.Wait()
	}

	waitForToken = func() (*oauth2.Token, error) {
		select {
		case code := <-codeCh:
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			token, err := oauthCfg.Exchange(ctx, code)
			if err != nil {
				return nil, fmt.Errorf("exchanging oauth code: %w", err)
			}
			return token, nil
		case err := <-errCh:
			return nil, err
		case <-time.After(5 * time.Minute):
			return nil, fmt.Errorf("oauth flow timed out after 5 minutes")
		}
	}

	return authURL, waitForToken, cleanup, nil
}

// tokenCacheDir returns the directory for caching OAuth tokens.
func tokenCacheDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".schemastudio")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	return dir, nil
}

// tokenCachePath returns the file path for a cached token for the given project.
func tokenCachePath(project string) (string, error) {
	dir, err := tokenCacheDir()
	if err != nil {
		return "", err
	}
	// Sanitize project name for use as filename
	safe := project
	for _, ch := range []string{"/", "\\", ":", "*", "?", "\"", "<", ">", "|"} {
		safe = filepath.Clean(safe)
		_ = ch
	}
	return filepath.Join(dir, fmt.Sprintf("bigquery-token-%s.json", safe)), nil
}

// SaveToken saves an OAuth2 token to the cache file.
func SaveToken(project string, token *oauth2.Token) error {
	path, err := tokenCachePath(project)
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(token, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

// LoadToken loads a cached OAuth2 token for the given project.
func LoadToken(project string) (*oauth2.Token, error) {
	path, err := tokenCachePath(project)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var token oauth2.Token
	if err := json.Unmarshal(data, &token); err != nil {
		return nil, err
	}
	return &token, nil
}

// loadCachedTokenSource returns a token source using a cached token for the given project.
// It will automatically refresh the token when it expires if a refresh token is present.
func loadCachedTokenSource(project string) (oauth2.TokenSource, error) {
	token, err := LoadToken(project)
	if err != nil {
		return nil, fmt.Errorf("no cached token for project %s: %w", project, err)
	}

	// We need the OAuth config to create a refreshing token source.
	// Load the client config from saved settings.
	clientCfg, err := LoadOAuthClientConfig()
	if err != nil {
		// Fallback: use the token as-is (won't auto-refresh)
		return oauth2.StaticTokenSource(token), nil
	}

	oauthCfg := DefaultOAuthConfig(clientCfg.ClientID, clientCfg.ClientSecret)
	return oauthCfg.TokenSource(context.Background(), token), nil
}

// oauthClientConfigPath returns the path to the saved OAuth client configuration.
func oauthClientConfigPath() (string, error) {
	dir, err := tokenCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "oauth-client.json"), nil
}

// SaveOAuthClientConfig saves the OAuth client ID/secret to disk.
func SaveOAuthClientConfig(cfg OAuthClientConfig) error {
	path, err := oauthClientConfigPath()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

// LoadOAuthClientConfig loads the saved OAuth client configuration.
func LoadOAuthClientConfig() (*OAuthClientConfig, error) {
	path, err := oauthClientConfigPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg OAuthClientConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}
