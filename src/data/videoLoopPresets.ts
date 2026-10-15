export type VideoLoopPreset = {
  id: string;
  label: string;
  loop: boolean;
  prompt: string;
};

export const videoLoopPresets: VideoLoopPreset[] = [
  {
    id: "generic",
    label: "Generic cycle",
    loop: true,
    prompt:
      "A smooth looping cycle of the character's motion. The character performs one complete action and returns exactly to the starting pose by the end of the clip.",
  },
  {
    id: "idle",
    label: "Idle",
    loop: true,
    prompt:
      "A subtle looping idle animation: gentle breathing, small weight shift, and tiny secondary motion. The character stands in place and returns exactly to the starting pose.",
  },
  {
    id: "walk",
    label: "Walk",
    loop: true,
    prompt:
      "A walk cycle in place with clear alternating contact, down, passing, and up poses. The character stays centered, faces the same direction, and returns exactly to the first contact pose.",
  },
  {
    id: "run",
    label: "Run",
    loop: true,
    prompt:
      "A run cycle in place with a forward lean, alternating leg contacts, and coordinated arm swing. The character stays centered and returns exactly to the first pose.",
  },
  {
    id: "attack",
    label: "Attack",
    loop: true,
    prompt:
      "An attack action with anticipation, a decisive strike, and a full recovery back to the starting stance by the end of the clip, so the motion loops seamlessly.",
  },
];

export function videoLoopPresetById(id?: string): VideoLoopPreset {
  return videoLoopPresets.find((preset) => preset.id === id) ?? videoLoopPresets[0];
}
