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
| **R** redirect to cursor | *(unbound by default - open palm is neutral)* | grip - elements fly to where you aim | R (to the cursor) |
| *new:* **sweep** | just move your hand - elements near it (of your hand's element) get pushed along | move the controller | move the mouse |
| **B** cool water | pinch thumb + middle | B / Y | B |
| Fire / Water / Air | pinch thumb + ring cycles, or pick it in the menu | thumbstick click cycles, or pick it in the menu | on-screen buttons, E |

## Pushing and momentum

* **Sweep:** move your hand and elements of *your hand's element* within ~40 cm of it get pushed the way the hand moves (a water hand pushes water, a fire hand pushes fire).
  It's an impulse, so it's physical: the faster and longer you sweep, the faster they go (capped), and they keep that momentum afterwards.
* **Cancelling:** sweep the opposite way by the same amount and the momentum is cancelled exactly; half as much leaves half; too far reverses it.
* **Condensed fire keeps moving:** the fire game slowed flames the more they were compressed. Now compression only squeezes flames (colour/heat) and never kills momentum; fire is slowed only by drag (`CFG.fireDrag`) and by walls. Water also keeps its horizontal momentum (the fire game damped it 2% per frame).
* Strength and radius are in the WORLD tab (`Hand push strength` 0 turns it off, `?sweep=` in the URL). Bind **Sweep** to a gesture (e.g. open palm) if you'd rather push only when you choose to.

## The menu (nothing is on screen until you ask for it)

A small **menu button** (a `≡` with wave / lives / score) floats over the back of your menu hand like a watch and only shows
while you look at it. **Poke it** (Quest 3 hands) or **point + trigger** (controllers) to open the menu in front of you; hit it again or **X** to close.
Prefer a button / gesture? Bind **Open menu** to anything in the hand tabs.

| Tab | What you can change |
|---|---|
| **PLAY** | Start / resume / play again, and a summary of what each hand does right now |
| **LEFT HAND / RIGHT HAND** | The hand's **element** (fire / water / air), which **gesture or button** triggers *Cast, Empower, Redirect, Cool, Switch element, Open menu*, and "hold on" latches (CAST / HEAT / PULL / COOL stay on without holding anything). Toggle between editing hand **gestures** (pinch index/middle/ring/pinky, fist, open palm) and **controller buttons** (trigger, grip, A/X, B/Y, stick click). |
| **WORLD** | Particles per tick, compression, colour rate, lifetime multiplier, water gravity, empower/cool reach, particle cap, which hand wears the menu button, room-surface overlay, reset |

Everything is saved on the headset (localStorage). Defaults: left hand **water**, right hand **fire**; pinch index = cast,
fist = empower, pinch middle = cool, pinch ring = switch element, **sweep = always on** (controllers: trigger, A/X, grip = redirect, B/Y, stick click).
Open palm does nothing by default; bind it to anything you like. Redirect (if you bind it) gets a little aim assist toward creatures.

## Real-world collision

Elements bounce off your real room instead of passing through it.

| Headset | What it collides with |
|---|---|
| **Quest 3 / 3S** | The room scan from *Space Setup* (WebXR `mesh-detection`: walls, floor, ceiling, tables, couches), plus detected planes (`plane-detection`). The browser asks for "spatial data" permission the first time. |
| **Quest 2** | Has no room scan, so: the floor and your **Guardian boundary** as walls (`bounded-floor`). Furniture can't be detected on Quest 2. |
| Anything else | Floor only. |

* Water splashes, bounces and rests on tables; fire is shoved back and kicks off walls (with a few sparks); air gusts deflect.
* The WORLD tab / `?showmesh=1` shows the surfaces it found (`env.label()` reads `Room scan: N tris`, `Guardian walls + floor`, or `Floor only`). If a Quest 3 only gets the floor, run Space Setup (Settings -> Physical space -> Space setup) and relaunch.
* Add `?showmesh=1` to draw the collision surfaces, or `?demo=1` in the on-screen preview to try a virtual table, wall and pillar.
* Creatures still fly through walls (they come from the rift).

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
js/environment.js real-world collision (room mesh / planes / Guardian)
js/game.js        creatures, waves, damage rules
js/ui.js          pokeable / pointable in-world panels
js/menu.js        the menu (tabs, bindings, tuning) and the wrist menu button
js/settings.js    saved per-hand element + bindings, world tuning
lib/              three.js r186 (MIT)
```

## Notes

* Gesture thresholds live at the top of `js/gestures.js` (`T`) if pinches feel too tight/loose for your hands.
* Particle cap is `CFG.maxParticles` (550) in `js/config.js` to keep Quest frame times steady.
