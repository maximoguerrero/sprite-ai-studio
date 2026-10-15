export const animationPresets = [
  {
    id: "custom",
    label: "Custom",
    frames: 8,
    loop: true,
    prompt: "",
    phases: [
      "Starting pose",
      "Anticipation",
      "Action begins",
      "Mid-action",
      "Peak action",
      "Follow-through",
      "Return",
      "Loop pose",
    ],
  },
  {
    id: "idle",
    label: "Idle",
    frames: 8,
    loop: true,
    prompt:
      "A seamless idle animation. Add subtle breathing and small secondary motion while keeping the character's silhouette, outfit, palette, and position consistent.",
    phases: ["Neutral", "Inhale", "Body rises", "Breath peak", "Exhale", "Body settles", "Neutral return", "Loop pose"],
  },
  {
    id: "walk",
    label: "Walk",
    frames: 8,
    loop: true,
    prompt:
      "A continuous walk cycle in place, facing the same direction throughout. Use clear alternating contact and passing poses; keep the character size and baseline consistent for a seamless loop.",
    phases: [
      "Right foot contact",
      "Down pose",
      "Passing pose",
      "Up pose",
      "Left foot contact",
      "Down pose",
      "Passing pose",
      "Return to contact",
    ],
  },
  {
    id: "run",
    label: "Run",
    frames: 8,
    loop: true,
    prompt:
      "A fast run cycle in place with a forward lean, alternating leg contacts, and coordinated arm swing. Keep the character design, facing, scale, and baseline consistent; loop seamlessly.",
    phases: [
      "Right contact",
      "Airborne",
      "Left contact",
      "Airborne",
      "Right contact",
      "Airborne",
      "Left contact",
      "Return to start",
    ],
  },
  {
    id: "jump",
    label: "Jump",
    frames: 8,
    loop: false,
    prompt:
      "A complete jump action: crouch, takeoff, clear airborne pose, descent, and landing recovery. Keep the design and facing consistent. This is a one-shot animation.",
    phases: ["Anticipation crouch", "Takeoff", "Rising", "Peak", "Begin descent", "Landing", "Impact", "Recovery"],
  },
  {
    id: "attack",
    label: "Attack",
    frames: 8,
    loop: false,
    prompt:
      "A readable attack action with anticipation, a decisive strike, and recovery. Preserve the same character, weapon, facing, and proportions. This is a one-shot animation.",
    phases: ["Ready", "Wind-up", "Strike begins", "Impact", "Follow-through", "Recover", "Return to stance", "Hold"],
  },
  {
    id: "hurt",
    label: "Hurt",
    frames: 8,
    loop: false,
    prompt:
      "A brief hurt reaction: recoil from impact, show a clear readable hit pose, then recover slightly. Preserve character identity and facing. One-shot animation.",
    phases: ["Impact", "Recoil", "Stagger", "Brace", "Recover begins", "Recover", "Settle", "Hold"],
  },
  {
    id: "death",
    label: "Death",
    frames: 8,
    loop: false,
    prompt:
      "A readable defeat animation that transitions from the current pose into a final fallen pose. Preserve the character design and facing. One-shot animation.",
    phases: ["Hit", "Stagger", "Lose balance", "Fall", "Impact", "Settle", "Final pose", "Hold"],
  },
];
