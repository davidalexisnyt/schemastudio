declare global {
  interface Window {
    go?: {
      app?: {
        App?: {
          // --- Legacy file I/O (kept for backward compatibility) ---
          Save(path: string, content: string): Promise<void>;
          SaveBase64(path: string, base64Data: string): Promise<void>;
          Load(path: string): Promise<string>;
          Remove(path: string): Promise<void>;
          SaveFileDialog(
            title: string,
            defaultFilename: string,
            filterName: string,
            filterPattern: string,
          ): Promise<string>;
          OpenFileDialog(
            title: string,
            filterName: string,
            filterPattern: string,
          ): Promise<string>;
          OpenDirectoryDialog(title: string): Promise<string>;
          ListFiles(rootPath: string, pattern: string): Promise<string[]>;
          // --- Export/Import ---
          ExportSQL(dialect: string, jsonContent: string): Promise<string>;
          ExportPostgres(jsonContent: string, schema: string): Promise<string>;
          ExportBigQuery(
            jsonContent: string,
            project: string,
            dataset: string,
            creationMode: string,
          ): Promise<string>;
          ImportSQL(sqlContent: string, importSource: string): Promise<string>;
          ImportCSV(csvContent: string, importSource: string): Promise<string>;
          ImportMermaid(mermaidContent: string): Promise<string>;
          ExportMermaid(jsonContent: string): Promise<string>;
          ExportPlantUML(jsonContent: string): Promise<string>;
          Version(): Promise<string>;
          // --- Database connectivity ---
          TestDatabaseConnection(configJSON: string): Promise<string>;
          ListDatabaseSchemas(configJSON: string): Promise<string>;
          ListDatabaseTables(configJSON: string, schemaName: string): Promise<string>;
          ImportFromDatabase(configJSON: string, schemaName: string, tablesJSON: string): Promise<string>;
          SaveOAuthClientConfig(clientID: string, clientSecret: string): Promise<void>;
          LoadOAuthClientConfig(): Promise<string>;
          // --- Global connection profiles ---
          SaveConnectionProfile(name: string, configJSON: string): Promise<void>;
          LoadConnectionProfile(name: string): Promise<string>;
          ListConnectionProfiles(): Promise<string>;
          DeleteConnectionProfile(name: string): Promise<void>;
          // --- Keyring ---
          SaveProfilePassword(profileName: string, password: string): Promise<void>;
          LoadProfilePassword(profileName: string): Promise<string>;
          DeleteProfilePassword(profileName: string): Promise<void>;
          // --- Workspace lifecycle ---
          CreateWorkspace(filePath: string): Promise<string>;
          OpenWorkspace(filePath: string): Promise<string>;
          CloseWorkspace(wsID: string): Promise<void>;
          // --- Workspace settings ---
          GetWorkspaceSettings(wsID: string): Promise<string>;
          SaveWorkspaceSetting(wsID: string, key: string, value: string): Promise<void>;
          SaveWorkspaceSettings(wsID: string, settingsJSON: string): Promise<void>;
          // --- Catalog tables ---
          GetCatalogTables(wsID: string): Promise<string>;
          SaveCatalogTable(wsID: string, tableJSON: string): Promise<void>;
          DeleteCatalogTable(wsID: string, tableID: string): Promise<void>;
          // --- Catalog fields ---
          SaveCatalogField(wsID: string, fieldJSON: string): Promise<void>;
          DeleteCatalogField(wsID: string, fieldID: string): Promise<void>;
          // --- Catalog relationships ---
          GetCatalogRelationships(wsID: string): Promise<string>;
          SaveCatalogRelationship(wsID: string, relJSON: string): Promise<void>;
          DeleteCatalogRelationship(wsID: string, relID: string): Promise<void>;
          // --- Diagrams ---
          ListWorkspaceDiagrams(wsID: string): Promise<string>;
          GetDiagram(wsID: string, diagramID: string): Promise<string>;
          SaveDiagram(wsID: string, diagramJSON: string): Promise<void>;
          DeleteDiagram(wsID: string, diagramID: string): Promise<void>;
          // --- UI state ---
          GetUIState(wsID: string): Promise<string>;
          SaveUIState(wsID: string, stateJSON: string): Promise<void>;
          // --- Workspace connection profiles ---
          GetWorkspaceConnectionProfiles(wsID: string): Promise<string>;
          SaveWorkspaceConnectionProfile(wsID: string, profileJSON: string): Promise<void>;
          DeleteWorkspaceConnectionProfile(wsID: string, profileID: string): Promise<void>;
          ImportGlobalProfile(wsID: string, globalProfileName: string): Promise<void>;
          // --- Migration ---
          MigrateWorkspace(oldRootPath: string, newFilePath: string): Promise<string>;
        };
      };
    };
  }
}

const getApp = (): typeof window.go.app.App | undefined =>
  (window as any).go?.app?.App ??
  (window as any).go?.["schemastudio/internal/app"]?.App;

export async function saveFile(path: string, content: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  await app.Save(path, content);
}

export async function saveFileBase64(
  path: string,
  base64Data: string,
): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  await app.SaveBase64(path, base64Data);
}

export async function loadFile(path: string): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.Load(path);
}

export async function removeFile(path: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.Remove(path);
}

export async function saveFileDialog(
  title: string,
  defaultFilename: string,
  filterName: string,
  filterPattern: string,
): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.SaveFileDialog(title, defaultFilename, filterName, filterPattern);
}

export async function openFileDialog(
  title: string,
  filterName: string,
  filterPattern: string,
): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.OpenFileDialog(title, filterName, filterPattern);
}

export async function openDirectoryDialog(title: string): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.OpenDirectoryDialog(title);
}

export async function listFiles(rootPath: string, pattern: string): Promise<string[]> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.ListFiles(rootPath, pattern);
}

export async function exportSQL(
  dialect: string,
  jsonContent: string,
): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.ExportSQL(dialect, jsonContent);
}

export async function exportPostgres(
  jsonContent: string,
  schema: string,
): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.ExportPostgres(jsonContent, schema);
}

export async function exportBigQuery(
  jsonContent: string,
  project: string,
  dataset: string,
  creationMode: string,
): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.ExportBigQuery(jsonContent, project, dataset, creationMode);
}

export async function importSQL(
  sqlContent: string,
  importSource: string
): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.ImportSQL(sqlContent, importSource);
}

export async function importCSV(
  csvContent: string,
  importSource: string
): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.ImportCSV(csvContent, importSource);
}

export async function importMermaid(mermaidContent: string): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.ImportMermaid(mermaidContent);
}

export async function exportMermaid(jsonContent: string): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.ExportMermaid(jsonContent);
}

export async function exportPlantUML(jsonContent: string): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.ExportPlantUML(jsonContent);
}

export function isBackendAvailable(): boolean {
  return !!getApp();
}

/** Quit the Wails application. Falls back to window.close() in browser. */
export function quit(): void {
  if ((window as any).runtime?.Quit) {
    (window as any).runtime.Quit();
  } else {
    window.close();
  }
}

export async function getVersion(): Promise<string> {
  const app = getApp();
  if (!app || !(app as { Version?: () => Promise<string> }).Version)
    return "";
  return (app as { Version: () => Promise<string> }).Version();
}

// --- Database connectivity bridge functions ---

export async function testDatabaseConnection(configJSON: string): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.TestDatabaseConnection(configJSON);
}

export async function listDatabaseSchemas(configJSON: string): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.ListDatabaseSchemas(configJSON);
}

export async function listDatabaseTables(configJSON: string, schemaName: string): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.ListDatabaseTables(configJSON, schemaName);
}

export async function importFromDatabase(
  configJSON: string,
  schemaName: string,
  tablesJSON: string,
): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.ImportFromDatabase(configJSON, schemaName, tablesJSON);
}

export async function saveOAuthClientConfig(clientID: string, clientSecret: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.SaveOAuthClientConfig(clientID, clientSecret);
}

export async function loadOAuthClientConfig(): Promise<string> {
  const app = getApp();
  if (!app) return "{}";
  return app.LoadOAuthClientConfig();
}

export async function saveConnectionProfile(name: string, configJSON: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.SaveConnectionProfile(name, configJSON);
}

export async function loadConnectionProfile(name: string): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.LoadConnectionProfile(name);
}

export async function listConnectionProfiles(): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.ListConnectionProfiles();
}

export async function deleteConnectionProfile(name: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.DeleteConnectionProfile(name);
}

export async function saveProfilePassword(profileName: string, password: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.SaveProfilePassword(profileName, password);
}

export async function loadProfilePassword(profileName: string): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.LoadProfilePassword(profileName);
}

export async function deleteProfilePassword(profileName: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.DeleteProfilePassword(profileName);
}

// ---------------------------------------------------------------------------
// Workspace lifecycle
// ---------------------------------------------------------------------------

export async function createWorkspace(filePath: string): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.CreateWorkspace(filePath);
}

export async function openWorkspace(filePath: string): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.OpenWorkspace(filePath);
}

export async function closeWorkspace(wsID: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.CloseWorkspace(wsID);
}

// ---------------------------------------------------------------------------
// Workspace settings
// ---------------------------------------------------------------------------

export async function getWorkspaceSettings(wsID: string): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.GetWorkspaceSettings(wsID);
}

export async function saveWorkspaceSetting(wsID: string, key: string, value: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.SaveWorkspaceSetting(wsID, key, value);
}

export async function saveWorkspaceSettings(wsID: string, settingsJSON: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.SaveWorkspaceSettings(wsID, settingsJSON);
}

// ---------------------------------------------------------------------------
// Catalog tables
// ---------------------------------------------------------------------------

export async function getCatalogTables(wsID: string): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.GetCatalogTables(wsID);
}

export async function saveCatalogTable(wsID: string, tableJSON: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.SaveCatalogTable(wsID, tableJSON);
}

export async function deleteCatalogTable(wsID: string, tableID: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.DeleteCatalogTable(wsID, tableID);
}

// ---------------------------------------------------------------------------
// Catalog fields
// ---------------------------------------------------------------------------

export async function saveCatalogField(wsID: string, fieldJSON: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.SaveCatalogField(wsID, fieldJSON);
}

export async function deleteCatalogField(wsID: string, fieldID: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.DeleteCatalogField(wsID, fieldID);
}

// ---------------------------------------------------------------------------
// Catalog relationships
// ---------------------------------------------------------------------------

export async function getCatalogRelationships(wsID: string): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.GetCatalogRelationships(wsID);
}

export async function saveCatalogRelationship(wsID: string, relJSON: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.SaveCatalogRelationship(wsID, relJSON);
}

export async function deleteCatalogRelationship(wsID: string, relID: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.DeleteCatalogRelationship(wsID, relID);
}

// ---------------------------------------------------------------------------
// Diagrams
// ---------------------------------------------------------------------------

export async function listWorkspaceDiagrams(wsID: string): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.ListWorkspaceDiagrams(wsID);
}

export async function getDiagram(wsID: string, diagramID: string): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.GetDiagram(wsID, diagramID);
}

export async function saveDiagram(wsID: string, diagramJSON: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.SaveDiagram(wsID, diagramJSON);
}

export async function deleteDiagram(wsID: string, diagramID: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.DeleteDiagram(wsID, diagramID);
}

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------

export async function getUIState(wsID: string): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.GetUIState(wsID);
}

export async function saveUIState(wsID: string, stateJSON: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.SaveUIState(wsID, stateJSON);
}

// ---------------------------------------------------------------------------
// Workspace connection profiles
// ---------------------------------------------------------------------------

export async function getWorkspaceConnectionProfiles(wsID: string): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.GetWorkspaceConnectionProfiles(wsID);
}

export async function saveWorkspaceConnectionProfile(wsID: string, profileJSON: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.SaveWorkspaceConnectionProfile(wsID, profileJSON);
}

export async function deleteWorkspaceConnectionProfile(wsID: string, profileID: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.DeleteWorkspaceConnectionProfile(wsID, profileID);
}

export async function importGlobalProfile(wsID: string, globalProfileName: string): Promise<void> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.ImportGlobalProfile(wsID, globalProfileName);
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export async function migrateWorkspace(oldRootPath: string, newFilePath: string): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.MigrateWorkspace(oldRootPath, newFilePath);
}
