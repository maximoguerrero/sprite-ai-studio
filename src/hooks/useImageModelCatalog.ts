import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProviderProfile } from "../types";
import { testProviderConnection } from "../openAIProvider";
import { getProviderSecret } from "../providerSecrets";

export type ImageModelGroup = {
  profileId: string;
  profileName: string;
  models: string[];
  error?: string;
  loading: boolean;
};

export function imageModelChoiceId(profileId: string, model: string) {
  return `${profileId}::${model}`;
}

export function parseImageModelChoice(value: string) {
  const separator = value.indexOf("::");
  if (separator <= 0 || separator === value.length - 1) return null;
  return { profileId: value.slice(0, separator), model: value.slice(separator + 2) };
}

type CatalogEntry = { models: string[]; error?: string };

export function useImageModelCatalog(providerProfiles: ProviderProfile[]) {
  const [entries, setEntries] = useState<Record<string, CatalogEntry>>({});
  const [loadingProfileId, setLoadingProfileId] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());
  const profilesRef = useRef(providerProfiles);
  useEffect(() => {
    profilesRef.current = providerProfiles;
  }, [providerProfiles]);

  const loadProfile = useCallback(async (profile: ProviderProfile) => {
    if (inFlight.current.has(profile.id)) return;
    inFlight.current.add(profile.id);
    setLoadingProfileId(profile.id);
    try {
      if (profile.providerType === "parley") {
        setEntries((current) => ({
          ...current,
          [profile.id]: { models: [], error: "Parley has no models-list endpoint" },
        }));
        return;
      }
      await getProviderSecret(profile.id).catch(() => undefined);
      const result = await testProviderConnection(profile);
      const models = result.modelDetails.filter((model) => model.kind === "image").map((model) => model.id);
      setEntries((current) => ({ ...current, [profile.id]: { models } }));
    } catch (error) {
      setEntries((current) => ({
        ...current,
        [profile.id]: { models: [], error: error instanceof Error ? error.message : "Could not list models" },
      }));
    } finally {
      inFlight.current.delete(profile.id);
      setLoadingProfileId((current) => (current === profile.id ? null : current));
    }
  }, []);

  const refresh = useCallback(async () => {
    const targets = profilesRef.current.filter((profile) => profile.enabled !== false && profile.modelKind !== "text");
    await Promise.all(targets.map((profile) => loadProfile(profile)));
  }, [loadProfile]);

  const listedProfileIds = useRef("");
  useEffect(() => {
    const ids = providerProfiles
      .filter((profile) => profile.enabled !== false && profile.modelKind !== "text")
      .map((profile) => profile.id)
      .join(",");
    if (ids === listedProfileIds.current) return;
    listedProfileIds.current = ids;
    void refresh();
  }, [providerProfiles, refresh]);

  const groups = useMemo<ImageModelGroup[]>(
    () =>
      providerProfiles
        .filter((profile) => profile.enabled !== false && profile.modelKind !== "text")
        .map((profile) => {
          const entry = entries[profile.id];
          const configured = (profile.imageModel?.trim() || profile.model?.trim() || "").trim();
          const models = [...new Set([...(configured ? [configured] : []), ...(entry?.models ?? [])])];
          return {
            profileId: profile.id,
            profileName: profile.name,
            models,
            ...(entry?.error ? { error: entry.error } : {}),
            loading: loadingProfileId === profile.id && !entry,
          };
        })
        .filter((group) => group.models.length || group.loading),
    [providerProfiles, entries, loadingProfileId]
  );

  return { groups, refresh, loadingProfileId };
}
