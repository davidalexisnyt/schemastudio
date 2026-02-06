declare global {
  interface Window {
    go?: {
      app?: {
        App?: {
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
          TestDatabaseConnection(configJSON: string): Promise<string>;
          ListDatabaseSchemas(configJSON: string): Promise<string>;
          ListDatabaseTables(configJSON: string, schemaName: string): Promise<string>;
          ImportFromDatabase(configJSON: string, schemaName: string, tablesJSON: string): Promise<string>;
          SaveOAuthClientConfig(clientID: string, clientSecret: string): Promise<void>;
          LoadOAuthClientConfig(): Promise<string>;
          SaveConnectionProfile(name: string, configJSON: string): Promise<void>;
          LoadConnectionProfile(name: string): Promise<string>;
          ListConnectionProfiles(): Promise<string>;
          DeleteConnectionProfile(name: string): Promise<void>;
          SaveProfilePassword(profileName: string, password: string): Promise<void>;
          LoadProfilePassword(profileName: string): Promise<string>;
          DeleteProfilePassword(profileName: string): Promise<void>;
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
