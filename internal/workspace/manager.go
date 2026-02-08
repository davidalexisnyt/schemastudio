package workspace

import (
	"fmt"
	"sync"

	"github.com/google/uuid"
)

// WorkspaceManager manages multiple open workspaces, each backed by a SQLite database.
type WorkspaceManager struct {
	mu    sync.RWMutex
	repos map[string]*WorkspaceRepo // keyed by workspace ID
}

// NewManager creates a new empty WorkspaceManager.
func NewManager() *WorkspaceManager {
	return &WorkspaceManager{
		repos: make(map[string]*WorkspaceRepo),
	}
}

// CreateWorkspace creates a new .schemastudio file at filePath, initializes the
// schema, and returns the workspace ID and repo.
func (m *WorkspaceManager) CreateWorkspace(filePath string) (string, *WorkspaceRepo, error) {
	db, err := OpenDB(filePath)
	if err != nil {
		return "", nil, fmt.Errorf("open db: %w", err)
	}
	if err := InitSchema(db); err != nil {
		db.Close()
		return "", nil, fmt.Errorf("init schema: %w", err)
	}

	wsID := uuid.New().String()
	repo := NewRepo(db, filePath)

	m.mu.Lock()
	m.repos[wsID] = repo
	m.mu.Unlock()

	return wsID, repo, nil
}

// OpenWorkspace opens an existing .schemastudio file and returns the workspace
// ID and repo. It runs schema migration if needed.
func (m *WorkspaceManager) OpenWorkspace(filePath string) (string, *WorkspaceRepo, error) {
	db, err := OpenDB(filePath)
	if err != nil {
		return "", nil, fmt.Errorf("open db: %w", err)
	}
	if err := MigrateSchema(db); err != nil {
		db.Close()
		return "", nil, fmt.Errorf("migrate schema: %w", err)
	}

	wsID := uuid.New().String()
	repo := NewRepo(db, filePath)

	m.mu.Lock()
	m.repos[wsID] = repo
	m.mu.Unlock()

	return wsID, repo, nil
}

// CloseWorkspace closes the SQLite connection for a workspace and removes it
// from the manager.
func (m *WorkspaceManager) CloseWorkspace(wsID string) error {
	m.mu.Lock()
	repo, ok := m.repos[wsID]
	if ok {
		delete(m.repos, wsID)
	}
	m.mu.Unlock()

	if !ok {
		return fmt.Errorf("workspace %s not found", wsID)
	}
	return repo.Close()
}

// GetRepo returns the WorkspaceRepo for an open workspace, or nil if not found.
func (m *WorkspaceManager) GetRepo(wsID string) *WorkspaceRepo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.repos[wsID]
}

// CloseAll closes all open workspaces. Called at application shutdown.
func (m *WorkspaceManager) CloseAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, repo := range m.repos {
		repo.Close()
		delete(m.repos, id)
	}
}
