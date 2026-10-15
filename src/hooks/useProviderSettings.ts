import { useState, type FormEvent } from "react";
import type { ProviderProfile } from "../types";
import { providerProfileSchema } from "../schemas";
import { getProviderSecret, removeProviderSecret, saveProviderSecret } from "../providerSecrets";
import { testProviderConnection, type ProviderModelInfo } from "../openAIProvider";
import { makeId } from "../lib/ids";

export function useProviderSettings() {
  const [providerProfiles, setProviderProfiles] = useState<ProviderProfile[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerMessage, setProviderMessage] = useState("");
  const [providerModels, setProviderModels] = useState<string[]>([]);
  const [providerModelDetails, setProviderModelDetails] = useState<ProviderModelInfo[]>([]);
  const [providerDraftType, setProviderDraftType] =
    useState<NonNullable<ProviderProfile["providerType"]>>("openai-compatible");
  const activeProvider = providerProfiles.find((profile) => profile.id === activeProviderId) ?? null;

  function createProviderDraft(type: NonNullable<ProviderProfile["providerType"]> = "openai-compatible") {
    setActiveProviderId(null);
    setProviderDraftType(type);
    setProviderModels([]);
    setProviderModelDetails([]);
    setProviderMessage("");
  }

  async function saveProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const id = String(data.get("id") || makeId());
    const existing = providerProfiles.find((profile) => profile.id === id);
    const secret = String(data.get("apiKey") || "").trim();
    const providerType = String(data.get("providerType") || "openai-compatible") as NonNullable<
      ProviderProfile["providerType"]
    >;
    const rawModelKind = String(data.get("modelKind") || "image");
    const modelKind = rawModelKind === "text" ? "text" : rawModelKind === "video" ? "video" : "image";
    const imageToImage = providerType === "grok" || data.get("imageToImage") === "on";
    const transparency = data.get("transparency") === "on";
    let normalizedBaseUrl: string;
    try {
      const url = new URL(String(data.get("baseUrl") || "").trim());
      if (!url.hostname || (url.protocol !== "https:" && url.protocol !== "http:"))
        throw new Error("Provider URL must use HTTP or HTTPS.");
      normalizedBaseUrl = url.toString().replace(/\/+$/, "");
    } catch (error) {
      setProviderMessage(error instanceof Error ? error.message : "Enter a valid provider URL.");
      return;
    }
    const profile = providerProfileSchema.parse({
      id,
      name: String(data.get("name") || "OpenAI-compatible provider").trim(),
      providerType,
      modelKind,
      baseUrl: normalizedBaseUrl,
      model: String(data.get("model") || "").trim(),
      imageModel: String(data.get("imageModel") || "").trim() || undefined,
      videoModel: providerType === "grok" ? String(data.get("videoModel") || "").trim() || undefined : undefined,
      quality: String(data.get("quality") || "auto") as NonNullable<ProviderProfile["quality"]>,
      apiKeyConfigured: Boolean(secret || existing?.apiKeyConfigured),
      enabled: existing ? existing.enabled !== false : true,
      capabilities: {
        modelsList: existing?.capabilities?.modelsList ?? false,
        textToImage: true,
        imageToImage,
        transparency,
      },
      updatedAt: new Date().toISOString(),
    });
    if (secret) await saveProviderSecret(id, secret);
    else if (existing && !window.__TAURI_INTERNALS__) {
      try {
        await getProviderSecret(id);
      } catch {
        setProviderMessage("Enter an API key for this browser session before saving the provider.");
        return;
      }
    }
    const profileWithSecret = { ...profile, apiKeyConfigured: profile.apiKeyConfigured || Boolean(secret) };
    setProviderProfiles((current) => [profileWithSecret, ...current.filter((item) => item.id !== id)]);
    setActiveProviderId(id);
    setProviderModels([]);
    setProviderMessage(secret ? "Provider profile and credential saved." : "Provider profile saved.");
  }

  async function testActiveProvider() {
    if (!activeProvider) return;
    setProviderBusy(true);
    if (activeProvider.providerType === "parley") {
      try {
        await getProviderSecret(activeProvider.id);
        setProviderMessage("Parley API key is available. The first image request will verify the connection.");
      } catch (error) {
        setProviderMessage(error instanceof Error ? error.message : "API key is unavailable.");
      } finally {
        setProviderBusy(false);
      }
      return;
    }
    setProviderMessage("Testing connection…");
    try {
      await getProviderSecret(activeProvider.id);
      const result = await testProviderConnection(activeProvider);
      setProviderModels(result.models);
      setProviderModelDetails(result.modelDetails);
      if (!result.modelsList) {
        const blocked = "modelsBlocked" in result && result.modelsBlocked;
        const imageModels = result.modelDetails.filter((entry) => entry.kind === "image").map((entry) => entry.id);
        const videoModels = result.modelDetails.filter((entry) => entry.kind === "video").map((entry) => entry.id);
        const autoImageModel = !activeProvider.imageModel && imageModels.length ? imageModels[0] : undefined;
        const autoVideoModel = blocked && !activeProvider.videoModel && videoModels.length ? videoModels[0] : undefined;
        const updated = {
          ...activeProvider,
          ...(autoImageModel ? { imageModel: autoImageModel } : {}),
          ...(autoVideoModel ? { videoModel: autoVideoModel } : {}),
          capabilities: {
            modelsList: false,
            textToImage: true,
            imageToImage:
              activeProvider.providerType === "grok" || (activeProvider.capabilities?.imageToImage ?? false),
            transparency: activeProvider.capabilities?.transparency ?? false,
          },
        };
        setProviderProfiles((current) => current.map((profile) => (profile.id === updated.id ? updated : profile)));
        setProviderMessage(
          blocked
            ? `xAI denied the models endpoint for this key (403). Enable it in console.x.ai, or pick from the known Grok models in the model fields.${autoVideoModel ? ` Video generation will use “${autoVideoModel}”.` : ""}`
            : "Parley profile is ready. Its supplied API documentation does not include a models-list endpoint, so the first generation request will verify the connection."
        );
        return;
      }
      const imageModels = result.modelDetails.filter((entry) => entry.kind === "image").map((entry) => entry.id);
      const videoModels = result.modelDetails.filter((entry) => entry.kind === "video").map((entry) => entry.id);
      const autoImageModel = !activeProvider.imageModel && imageModels.length ? imageModels[0] : undefined;
      const autoVideoModel =
        activeProvider.providerType === "grok" && !activeProvider.videoModel && videoModels.length
          ? videoModels[0]
          : undefined;
      const updated = {
        ...activeProvider,
        ...(autoImageModel ? { imageModel: autoImageModel } : {}),
        ...(autoVideoModel ? { videoModel: autoVideoModel } : {}),
        capabilities: {
          ...(activeProvider.capabilities ?? {
            textToImage: true,
            imageToImage: false,
            transparency: false,
            modelsList: false,
          }),
          modelsList: true,
        },
      };
      setProviderProfiles((current) => current.map((profile) => (profile.id === updated.id ? updated : profile)));
      setProviderMessage(
        result.models.length
          ? `Connected. Found ${result.models.length} models (${imageModels.length} image-capable${videoModels.length ? `, ${videoModels.length} video-capable` : ""}).${autoImageModel ? ` Image generation will use “${autoImageModel}”.` : activeProvider.imageModel ? ` Image generation will use “${activeProvider.imageModel}”.` : " No image-capable model detected; image generation will use the configured model."}`
          : "Endpoint responded; no model list was returned."
      );
    } catch (error) {
      setProviderMessage(error instanceof Error ? error.message : "Provider connection failed.");
    } finally {
      setProviderBusy(false);
    }
  }

  async function loadProviderModels() {
    if (!activeProvider) return;
    if (activeProvider.providerType === "parley") {
      setProviderMessage("Parley does not expose a models-list endpoint.");
      return;
    }
    setProviderBusy(true);
    setProviderMessage("Loading models from the API…");
    try {
      await getProviderSecret(activeProvider.id);
      const result = await testProviderConnection(activeProvider);
      setProviderModels(result.models);
      setProviderModelDetails(result.modelDetails);
      if (!result.modelsList) {
        setProviderMessage(
          "xAI denied the models endpoint for this key (403). Enable model access in console.x.ai, or pick from the known Grok models listed in the model fields."
        );
        return;
      }
      const imageModels = result.modelDetails.filter((entry) => entry.kind === "image").map((entry) => entry.id);
      const videoModels = result.modelDetails.filter((entry) => entry.kind === "video").map((entry) => entry.id);
      const autoImageModel = !activeProvider.imageModel && imageModels.length ? imageModels[0] : undefined;
      const autoVideoModel =
        activeProvider.providerType === "grok" && !activeProvider.videoModel && videoModels.length
          ? videoModels[0]
          : undefined;
      const updated = {
        ...activeProvider,
        ...(autoImageModel ? { imageModel: autoImageModel } : {}),
        ...(autoVideoModel ? { videoModel: autoVideoModel } : {}),
        capabilities: {
          ...(activeProvider.capabilities ?? {
            textToImage: true,
            imageToImage: false,
            transparency: false,
            modelsList: false,
          }),
          modelsList: true,
        },
      };
      setProviderProfiles((current) => current.map((profile) => (profile.id === updated.id ? updated : profile)));
      setProviderMessage(
        result.models.length
          ? `Loaded ${result.models.length} models (${imageModels.length} image-capable${videoModels.length ? `, ${videoModels.length} video-capable` : ""}) from the API.${autoImageModel ? ` Image generation will use “${autoImageModel}”.` : activeProvider.imageModel ? ` Image generation will use “${activeProvider.imageModel}”.` : ""}`
          : "The API returned no models."
      );
    } catch (error) {
      setProviderMessage(error instanceof Error ? error.message : "Could not load models from the API.");
    } finally {
      setProviderBusy(false);
    }
  }

  function toggleProviderEnabled(id: string) {
    setProviderProfiles((current) =>
      current.map((profile) => (profile.id === id ? { ...profile, enabled: profile.enabled === false } : profile))
    );
  }

  async function deleteActiveProvider() {
    if (!activeProvider || !window.confirm(`Remove provider “${activeProvider.name}” and its saved credential?`))
      return;
    try {
      await removeProviderSecret(activeProvider.id);
    } catch {
      /* Missing key is already deleted. */
    }
    setProviderProfiles((current) => current.filter((profile) => profile.id !== activeProvider.id));
    setActiveProviderId(providerProfiles.find((profile) => profile.id !== activeProvider.id)?.id ?? null);
    setProviderModels([]);
    setProviderModelDetails([]);
    setProviderMessage("Provider removed.");
  }

  return {
    providerProfiles,
    setProviderProfiles,
    activeProviderId,
    setActiveProviderId,
    providerBusy,
    providerMessage,
    setProviderMessage,
    providerModels,
    setProviderModels,
    providerModelDetails,
    providerDraftType,
    activeProvider,
    toggleProviderEnabled,
    createProviderDraft,
    saveProvider,
    testActiveProvider,
    loadProviderModels,
    deleteActiveProvider,
  };
}
