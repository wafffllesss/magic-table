export {};

declare global {
  interface Window {
    meuMagicDesktop?: {
      isElectron: true;
      showNotification(title: string, body: string): Promise<void>;
      checkForUpdate(): Promise<{ currentVersion: string; version: string; url: string } | null>;
      openUpdate(): Promise<void>;
      onInvite(callback: (code: string) => void): () => void;
      onBeforeQuit(callback: () => void): () => void;
      completeBeforeQuit(): void;
      startMcpServer(): Promise<string>;
      stopMcpServer(): Promise<void>;
      onMcpToolCall(callback: (payload: { id: string; tool: string; args: Record<string, unknown> }) => void): () => void;
      resolveMcpTool(id: string, result?: unknown, error?: string): void;
      startLegacyMigration(): Promise<boolean>;
      sendLegacyMigrationEvent(payload: unknown): Promise<void>;
      finishLegacyMigration(error?: string): Promise<void>;
      onLegacyMigrationEvent(callback: (payload: { id: string; event: unknown }) => void): () => void;
      acknowledgeLegacyMigrationEvent(id: string, error?: string): void;
    };
  }
}
