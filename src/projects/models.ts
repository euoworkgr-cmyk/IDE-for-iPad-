export type LanguageId =
  | "c"
  | "cpp"
  | "csharp"
  | "python"
  | "javascript"
  | "typescript"
  | "html"
  | "css"
  | "json"
  | "sql"
  | "php"
  | "text";

export interface ProjectFile {
  id: string;
  path: string;
  content: string;
  language: LanguageId;
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  files: ProjectFile[];
  activeFileId: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionState {
  activeProjectId: string;
}

export function createId(): string {
  try {
    const webCrypto = globalThis.crypto;
    if (typeof webCrypto?.randomUUID === "function") {
      return webCrypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    if (typeof webCrypto?.getRandomValues === "function") {
      webCrypto.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const value = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  } catch {
    return `alt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

export function languageFromPath(path: string): LanguageId {
  const extension = path.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "c":
    case "h":
      return "c";
    case "cc":
    case "cp":
    case "cpp":
    case "cxx":
    case "hh":
    case "hpp":
    case "hxx":
      return "cpp";
    case "cs":
      return "csharp";
    case "py":
      return "python";
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return "typescript";
    case "html":
    case "htm":
      return "html";
    case "css":
      return "css";
    case "json":
      return "json";
    case "sql":
      return "sql";
    case "php":
    case "phtml":
      return "php";
    default:
      return "text";
  }
}

export function createFile(path: string, content = ""): ProjectFile {
  const now = Date.now();

  return {
    id: createId(),
    path,
    content,
    language: languageFromPath(path),
    createdAt: now,
    updatedAt: now
  };
}

export function createProject(name: string): Project {
  const now = Date.now();
  // Python is the seed language because it is one of the languages Altitude can
  // actually execute. A new project must open on a file where pressing Run
  // does something.
  const program = createFile(
    "main.py",
    `# Welcome to Altitude.\n# Press the Run button, or Cmd/Ctrl+Enter, to run this file.\n\n\ndef greet(name):\n    return f"Hello, {name}!"\n\n\nprint(greet("iPad"))\n`
  );

  return {
    id: createId(),
    name,
    files: [program],
    activeFileId: program.id,
    createdAt: now,
    updatedAt: now
  };
}
