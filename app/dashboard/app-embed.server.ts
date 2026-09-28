// Detects whether the merchant has turned on Nomi's "Nomi Script" app embed
// (extensions/nomi-theme/blocks/nomi-script.liquid) in their live theme.
//
// Shopify doesn't expose app-embed state directly. The documented way is to
// read the published theme's config/settings_data.json: an embed appears
// under `current.blocks` once it's been enabled, keyed by a type like
// `shopify://apps/<app>/blocks/nomi-script/<uuid>`, and stays there with
// `disabled: true` after being switched off. Needs read_themes only.

export const NOMI_EMBED_HANDLE = "nomi-script";

export type AppEmbedState = "active" | "inactive" | "unknown";

export type AppEmbedStatus = {
  state: AppEmbedState;
  themeName: string | null;
};

interface GraphqlAdmin {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

const APP_EMBED_THEME_QUERY = `#graphql
  query NomiAppEmbedTheme {
    currentAppInstallation {
      app {
        handle
      }
    }
    themes(first: 1, roles: [MAIN]) {
      nodes {
        id
        name
        files(filenames: ["config/settings_data.json"], first: 1) {
          nodes {
            filename
            body {
              ... on OnlineStoreThemeFileBodyText {
                content
              }
            }
          }
        }
      }
    }
  }
`;

type ThemeQueryResult = {
  data?: {
    currentAppInstallation?: { app?: { handle?: string | null } | null } | null;
    themes?: {
      nodes: Array<{
        name: string;
        files?: { nodes: Array<{ body?: { content?: string } | null }> } | null;
      }>;
    };
  };
};

type EmbedBlock = { type?: unknown; disabled?: unknown };

const EMBED_TYPE_PATTERN = new RegExp(
  `^shopify://apps/[^/]+/blocks/${NOMI_EMBED_HANDLE}/`,
);

// settings_data.json ships with a leading /* ... */ banner comment, which
// JSON.parse rejects. Returns null when the file can't be read as JSON.
// With appHandle, only this app's embed counts (block types are
// `shopify://apps/<app handle>/blocks/...`), so another Nomi app's leftover
// embed, like the retired custom "Nomi" app's, doesn't pass the gate.
export function isNomiEmbedEnabled(settingsDataText: string, appHandle?: string | null): boolean | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(settingsDataText.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ""));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as { current?: unknown; presets?: Record<string, unknown> };
  // Older themes can store `current` as the name of a preset.
  const current =
    typeof root.current === "string" ? root.presets?.[root.current] : root.current;
  const blocks = (current as { blocks?: Record<string, EmbedBlock> } | undefined)?.blocks;
  if (!blocks || typeof blocks !== "object") return false;

  return Object.values(blocks).some(
    (block) =>
      typeof block?.type === "string" &&
      EMBED_TYPE_PATTERN.test(block.type) &&
      (!appHandle || block.type.startsWith(`shopify://apps/${appHandle}/`)) &&
      block.disabled !== true,
  );
}

export async function loadAppEmbedStatus(admin: GraphqlAdmin): Promise<AppEmbedStatus> {
  try {
    const response = await admin.graphql(APP_EMBED_THEME_QUERY);
    const json = (await response.json()) as ThemeQueryResult;
    const theme = json.data?.themes?.nodes[0];
    if (!theme) return { state: "unknown", themeName: null };
    const content = theme.files?.nodes[0]?.body?.content;
    // No settings_data.json at all means nothing has ever been enabled.
    if (content === undefined) return { state: "inactive", themeName: theme.name };
    const enabled = isNomiEmbedEnabled(content, json.data?.currentAppInstallation?.app?.handle);
    return {
      state: enabled === null ? "unknown" : enabled ? "active" : "inactive",
      themeName: theme.name,
    };
  } catch (error) {
    console.error("[nomi] app embed status check failed", error);
    return { state: "unknown", themeName: null };
  }
}

// Shopify's documented deep link: opens the live theme's editor on App
// embeds with Nomi Script already switched on, so the merchant only saves.
export function appEmbedEditorUrl(shop: string, apiKey: string): string {
  return `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${encodeURIComponent(apiKey)}/${NOMI_EMBED_HANDLE}`;
}
