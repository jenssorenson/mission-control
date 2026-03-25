# Agent Workshop 3D — Architecture Summary

## What was built

A production-quality 3D agent visualization for the Mission Control page at
`/Users/jens/.openclaw/workspace/openclaw-mission-control/src/components/AgentWorkshop3D.tsx`
that renders agents as workstations in a digital workshop using React Three Fiber.

---

## Technology Evaluation

| Technology | Pros | Cons | Decision |
|---|---|---|---|
| **React Three Fiber** | Declarative JSX, Three.js ecosystem, great performance with instancing, automatic memory management | Extra dependency (~50KB) | ✅ **Selected** |
| **Raw Three.js** | Full control, minimal deps | Verbose, manual scene graph management, React integration requires useRef/useEffect boilerplate | Skipped |
| **Babylon.js** | Excellent GUI editor, great physics | Heavy, React integration via @babylon.js/react is less mature than R3F | Skipped |

**Why React Three Fiber:** Declarative composition maps naturally to React's component model.
The `useFrame` hook replaces `requestAnimationFrame`, `Html` from `@react-three/drei`
enables DOM tooltips inside the 3D canvas, and `OrbitControls` handles all camera interaction.
Performance is acceptable for 3 agents using simple geometry and no heavy assets.

---

## New Dependencies

```json
"@react-three/fiber": "^-9.x",
"@react-three/drei": "^-10.x",
"three": "^0.183.2",
"@types/three": "^0.183.1"
```

All four were already added to `package.json` via `npm install`.

---

## Architecture

```
src/
  components/
    AgentWorkshop3D.tsx   ← Main 3D canvas + 2D fallback + view toggle
    Dashboard.tsx         ← Updated: passes subAgents to Workshop
    Workshop.tsx         ← Updated: wraps AgentWorkshop3D, retains CSS header
    AgentMonitor.tsx      ← Updated: lifts subAgents state via onSubAgentsChange
  hooks/
    useWebGLSupport.ts    ← WebGL detection hook (used for future hardening)
```

### Component Tree

```
Dashboard
  └── Workshop  (agents + subAgents)
        └── AgentWorkshop3D  (viewMode: '3d' | '2d')
              ├── Canvas (R3F)  ← 3D scene (WebGL)
              │     ├── SceneLighting
              │     ├── SceneFloor + gridHelper
              │     ├── CommandBoard (holographic mission display)
              │     ├── AgentWorkstation × N  (one per agent)
              │     │     ├── Platform (cylinder)
              │     │     ├── Desk (box) + legs
              │     │     ├── Monitor (screen glow, emissive material)
              │     │     ├── Keyboard
              │     │     ├── Agent robot (capsule body + sphere head + antenna)
              │     │     ├── Status halo (torus ring, color per state)
              │     │     └── Html (labels, hover tooltips, click inspection)
              │     ├── TaskBeam × N  (animated THREE.Line between active agents)
              │     ├── AgentInspectionPanel (Html, shown on click)
              │     └── OrbitControls (orbit/pan/zoom)
              │
              └── Fallback2DWorkshop  ← 2D card list (WebGL unavailable)
```

---

## Data Binding — How Real Data Maps into the Scene

| Source | Field | Maps To |
|---|---|---|
| `Agent.status` | `'active' \| 'idle' \| 'thinking'` | `sceneStatus` → platform glow color, halo color, agent eye color, screen emissive |
| `Agent.runtime` | `'dev' \| 'pi' \| 'gemini'` | Agent body emissive tint, label badge color |
| `Agent.name` | string | Html label above workstation |
| `SubAgent[]` (from `localhost:18789/status`) | session list | `subAgentCount` shown in inspection panel; `taskName` of active session shown in tooltip and Html label |
| `SubAgent[].status` | string | TaskBeam active/pending between workstations |

**Task flow beams:** For every pair of agents where the source agent is `active`,
a `THREE.Line` beam is drawn between their workstations with green emissive material.
This visualizes inter-agent task handoff or collaboration.

---

## Agent States (color mapping)

| State | Status Color | Emissive | Halo | Effect |
|---|---|---|---|---|
| `active` | `#34d399` (green) | High | Torus ring, pulsing | Floating animation speed doubles |
| `thinking` | `#fbbf24` (amber) | Medium | Torus ring | Gentle float, thought bubble |
| `idle` | `#3b7aff` (blue) | Low | Torus ring (dim) | Slow float |
| `offline` | `#4a5580` (gray) | None | No halo | No animation |

---

## Performance Considerations

- **No heavy assets** — all geometry is Three.js primitives (Box, Cylinder, Sphere, Capsule, Torus)
- **No texture loading** — materials use solid colors + emissive
- **Instancing not needed** — only 3 agents exist; instancing would add complexity for no benefit
- **`Suspense` boundary** wraps the scene for async safety
- **`OrbitControls`** is configured with `minDistance/maxDistance` clamps to prevent extreme zoom
- **WebGL `powerPreference: 'high-performance'`** hint passed to `gl` context creation
- **CSS fallback** via 2D toggle for environments where WebGL is unavailable

---

## WebGL Fallback

`useWebGLSupport` hook in `src/hooks/useWebGLSupport.ts` attempts to create a `canvas` context
(`webgl2` → `webgl` → `experimental-webgl`). The result can gate whether the 3D Canvas
or the `Fallback2DWorkshop` is shown. The current implementation uses a view-mode toggle
(`3d` / `2d` buttons) rather than auto-detection, giving users explicit control.

---

## Future Improvements

1. **Auto WebGL detection** — use `useWebGLSupport` to automatically switch to 2D if unavailable
2. **Real-time task beam animation** — interpolate particle effects along beams to show data flow direction
3. **Agent-to-agent beam routing** — draw task beams along bezier curves rather than straight lines for a more organic look
4. **More agents** — position calculation currently assumes ≤ 3 agents; generalize to N agents with circular layout
5. **Sub-agent drill-down** — click an agent to see individual sub-agent sessions in a side panel
6. **Sound effects** — typing sounds for active agents, ambient hum for the workshop
7. **Performance profiling** — add `Stats` component from `@react-three/drei` in development mode
8. **Post-processing** — add Bloom from `@react-three/postprocessing` for the emissive glow to really pop
9. **Mobile touch controls** — OrbitControls supports touch but the layout may need responsive adjustments
