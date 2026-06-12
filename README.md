# Compass

Compass is a Launchpad lightshow tool for experimenting with the lights you have imagined, built to be used together with Ableton Live.

## A Few Things to Know

**Pretty much everything here was written by AI.** I can read markup and stylesheets like HTML and CSS to some extent, but outside of that I basically cannot read code at all.

As you would expect, AI-written code is really hard to maintain. No matter how many times I told it to find and fix the root cause, AI cannot have all of the context. So whenever something broke, it often tried to slap another patch on top instead. I tried to push back against that, but honestly, even now there are still plenty of cases where racks do not process in the right order, or changing the order changes the output when it really should not. So yeah, things are still a bit of a mess.

The reason I started making this software was to test whether an idea I had always been thinking about could actually work. **It was personal software for myself from the beginning, and that has not really changed.** Because of that, I may change features however I want, or suddenly stop maintaining it.

That said, you are totally welcome to take this and plug it into your own project, or use it as a starting point for something else. (0BSD license.)

## Why Does This Even Exist?

Most lightshow software works by having you draw patterns frame by frame, then paint colors onto them. It is simple, clean, and gets the job done, but stacking multiple effects on top of each other is a pain. For example, if you want to rotate an effect while preserving the output properly, you can only rotate it in 90-degree steps.

Compass does things differently. While racks are being processed, it does not bake the result into Launchpad notes right away. Instead, it keeps a geometry timeline of strokes through most of the rack, applies effects to that, and only projects it onto the Launchpad note map at the end. The result is then sampled into notes for the playback range. That means effects like rotation, translation, and symmetry can be stacked and modulated without falling apart, at least in theory (in practice it is still pretty buggy in certain situations). It also makes room for device types that did not exist before. For example, you can draw a shape with the path device, modulate rotate and scale, throw time warp on top, and get something like the effect shown below.

https://github.com/user-attachments/assets/eca40f46-12f4-406c-8c69-3ab6e7293a05

## How to Use It With Ableton Live

Compass is not a standalone app. It generates MIDI notes and sends them into Ableton Live through a Max for Live bridge.

1. Open Ableton Live and add `max4live/CompassBridge.amxd` to your set.
2. Open the Compass desktop app.
3. Build a rack in Compass and preview the result.
4. Select a MIDI clip in Ableton Live if you want Compass to replace that clip's notes. If no MIDI clip is open, select a MIDI track and Compass will try to create an arrangement clip at the current playhead position.
5. Press `Send` in Compass.

## Can It Replace Plugins Like Eyedrop?

**No.** Like I said, Compass generates visuals from a completely different foundation, and that cuts both ways. Honestly, drawing effects frame by frame in Ableton Live still gets you cleaner, sharper results most of the time.

What I would actually suggest is sticking with something like Ableton Live for the bulk of your work, then pulling in Compass for the moments you really want to punch up. That combination can get you somewhere pretty cool.

## Development

Requirements:

- Node.js `24.13.1`
- npm `11.5.1`

Install:

```sh
npm ci
```

Run the Electron app:

```sh
npm start
```

Build the renderer-only web version:

```sh
npm run web:build
```
