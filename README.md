# Elemental Rift - WebXR AR game for Meta Quest

Command fire, water and air with your bare hands (Quest 3 hand tracking) or with the
controller buttons (Quest 2 and anything that isn't a Quest 3). Creatures float in from
a rift and you have to stop them before they reach you.

The particles are a 3D port of the **fire game** (`Zenith/fire game/index.html`).

## Run it

WebXR only works over **HTTPS** (or `localhost`). Two easy ways to get the game on your headset:

1. **Local server + your Quest on the same Wi-Fi**
   ```
   cd TestARGame
   npx serve .            # or: python -m http.server 8000
   ```
   Browsers treat `http://<pc-ip>:8000` as insecure, so either tunnel it
   (`npx localtunnel --port 8000`, `ngrok http 8000`, Cloudflare Tunnel) or use
   Chrome DevTools remote debugging with `adb reverse tcp:8000 tcp:8000` and open
   `http://localhost:8000` in the Quest Browser.
2. **GitHub Pages / Netlify / Vercel** - push this folder, it is plain static files (three.js is bundled in `lib/`).

Open the page in the **Meta Quest Browser**, press **Enter AR**.
On a normal PC / phone browser, **Preview on this screen** runs the same game with the mouse as your hand.

For hand tracking turn it on in the Quest: *Settings -> Movement tracking -> Hand tracking*.

## Controls

| Fire game key | Quest 3 hands | Quest 2 / Touch controllers | Preview (mouse) |
|---|---|---|---|
| **Q** spawn particles | pinch thumb + index | trigger | hold Q / click |
| **Space** empower | make a fist | A / X | Space |
| **R** redirect to cursor | open palm - elements fly to where the palm points | grip - elements fly to where you aim | R (to the cursor) |
| **B** cool water | pinch thumb + middle | B / Y | B |
| Fire / Water / Air buttons | pinch thumb + ring cycles, or poke the panel on the back of your left hand | thumbstick click cycles, or point at the panel above the left controller | on-screen buttons, E |

The left hand starts with **water**, the right hand with **fire**. Redirect gets a little aim assist toward creatures.

**Quest 2 / button mode** also adds a panel above your left controller with Fire / Water / Air buttons and
latching CAST / HEAT / PULL / COOL toggles (point + trigger). The scheme is auto-picked from the browser's
user agent (`Quest 3` -> hands, anything else -> buttons) and can be overridden on the start page or with `?scheme=hands|buttons`.

## How the particles map to the fire game

| Fire game | Here |
|---|---|
| overlap count = `power`, red -> yellow -> blue -> white every `changeRate` | same (`Fire.findPower`, `Fire.colorize`) |
| overlapping flames push each other apart by `overlap / compressionPower` | same |
| flame shrinks 2% per frame, dies near 0 (about 4 s) | same - physics runs on a fixed 60 Hz step so it is identical at 72/90/120 Hz |
| empower: `size += 2` | `size += 2px` equivalent, capped, only within arm's reach of the hand |
| redirect: speed = distance / 62.5, multiplier 1.05 decaying x0.985 | same, now in 3D |
| compression slows flames (`speedMultiplier -= 0.01` per overlap) | same, softer (0.004) and clamped at 0 (the original could go negative and drift backwards) |
| water: gravity, temperature, ice below 15, melts at 20, cold spreads, evaporates when hot | same; floor is the real floor (`local-floor`) |
| ice is rigid and pushes water away | same - frozen water floats in mid-air and shoves creatures |
| Air button (no behaviour) | new: gusts that shove flames/droplets, fan flames, cool water, knock creatures back |
| 3 tuning inputs (compression, change rate, particles per click) | URL params `?compression=100&rate=10&burst=8&gravity=2&max=450`, and the inputs in preview mode |

New interactions: fire heats water and melts ice (and is dampened by it).

## Creatures

* **Frost wisp** - melts under fire; hotter (more compressed) fire is faster.
* **Ember imp** - put out by water; cold water and ice hurt most. Fire heals it.
* **Stone husk** - only cracks under blue / white-hot fire (power >= 2 x change-rate). Soak it with water first for 2.5x fire damage.

Five hearts. Waves get bigger and faster.

## Files

```
index.html        landing page, preview-mode UI
js/main.js        renderer, WebXR session, panels, game flow
js/particles.js   Fire / Water / Air particles + 60 Hz world
js/render.js      instanced billboard particle renderer
js/gestures.js    hand-tracking gesture detection (pure maths)
js/input.js       hands / controllers / mouse -> "casters"
js/game.js        creatures, waves, damage rules
js/ui.js          pokeable / pointable in-world panels
lib/              three.js r186 (MIT)
```

## Notes

* Gesture thresholds live at the top of `js/gestures.js` (`T`) if pinches feel too tight/loose for your hands.
* Particle cap is `CFG.maxParticles` (450) in `js/config.js` to keep Quest frame times steady.
