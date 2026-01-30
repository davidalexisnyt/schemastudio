declare global {
  interface Window {
    go?: {
      app?: {
        App?: {
          Save(path: string, content: string): Promise<void>;
          SaveBase64(path: string, base64Data: string): Promise<void>;
          Load(path: string): Promise<string>;
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
          ExportSQL(dialect: string, jsonContent: string): Promise<string>;
          ExportBigQuery(
            jsonContent: string,
            project: string,
            dataset: string,
            creationMode: string,
          ): Promise<string>;
          ImportSQL(sqlContent: string): Promise<string>;
          ImportMermaid(mermaidContent: string): Promise<string>;
          ExportMermaid(jsonContent: string): Promise<string>;
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

export async function exportSQL(
  dialect: string,
  jsonContent: string,
): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.ExportSQL(dialect, jsonContent);
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

export async function importSQL(sqlContent: string): Promise<string> {
  const app = getApp();
  if (!app) throw new Error("Backend not available");
  return app.ImportSQL(sqlContent);
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

export function isBackendAvailable(): boolean {
  return !!getApp();
}
