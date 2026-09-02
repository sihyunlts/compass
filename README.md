<div align="center">
  <p><a href="README.ko.md">한국어</a></p>
  <img width="3840" height="1440" alt="Compass" src="https://github.com/user-attachments/assets/ba80995b-65fc-4e0d-94b1-c9448fe9bb1f" />
  <h1>Compass</h1>
  <p>Compass is a Launchpad lightshow tool that lets you quickly experiment with unique light effects using a rack based workflow.</p>
  <p>
    <a href="https://github.com/sihyunlts/compass/releases/latest">
      <img src="https://img.shields.io/github/v/release/sihyunlts/compass?label=Download" alt="Download Latest Release" />
    </a>
    <a href="LICENSE">
      <img src="https://img.shields.io/badge/License-0BSD-black" alt="0BSD License" />
    </a>
  </p>
</div>

## Please Read This First

**The code for Compass was written with the help of AI.** I only know how to read a bit of markup and stylesheets like HTML/CSS, and I have zero actual programming experience.

As you may know, AI doesn't perfectly understand context yet. When I asked it to solve a problem, it tended to find workarounds instead of fixing the root cause in the design itself. Of course, I tried my best to document things and create fixtures to prevent it from straying too far from basic design principles, but since I'm not used to building systematic structures either, my guidelines are pretty flawed. As a result, the app itself often doesn't work as intended. **Therefore, if you use this app, please be prepared for situations where a rack you just built might completely break in the very next version.**

I made this open source because people around me asked to try it out, but the original goal of this project was simply to satisfy my own curiosity about whether this idea was even possible. Even now, I am only improving it for my own personal use. In short, I might arbitrarily remove or change features, or I could suddenly stop maintaining the project altogether.

Unless you absolutely *must* use Compass's features within Ableton Live, I highly recommend trying out the Crystal Composition feature included in [Anth's Amethyst](https://amethyst.anthonyhfm.dev/). It is based on Compass's core ideas but utilizes a proper node-based interface, and unlike this project, it is being developed by an actual programmer, so I believe it will be far more reliable.

Lastly, Compass uses the [0BSD License](LICENSE), so feel free to add new devices or features, redistribute it, or freely implement Compass's functionalities into your own programs.

## Why is this necessary?

Traditionally, creating a Launchpad lightshow meant drawing patterns frame by frame and then adding colors to them. It's a very intuitive and easy to understand method, but it was incredibly difficult to make fine adjustments to a pattern. Finding the perfect effect meant repeating the drawing process countless times. Furthermore, things like rotating an effect by just 20° or adjusting its scale were practically impossible, which severely limited how accurately you could bring your ideas to life.

Compass, on the other hand, calculates everything based on lines/paths first and converts them into notes at the very end. This allows you to apply sequential effects like rotation, movement (translation), and symmetry. For example, if you draw a shape using the Path device and control its rotation and scale with a Modulator, you can easily create effects like the one below.

https://github.com/user-attachments/assets/1d18c875-45b7-4ec0-a8bf-5234ce4bdcd8

> [!NOTE]
> However, Compass cannot entirely replace the traditional workflow. Using a completely different method means you can create previously impossible effects, but it also means it can be highly inefficient or difficult to achieve specific shapes for certain types of effects.

## Getting Started

> [!NOTE]
> Compass generates MIDI notes and sends them to Ableton Live via a Max for Live bridge. Essentially, it acts like a plugin for Live.
> Therefore, to use the send feature, you need Ableton Live 10 Suite (Max 8) or higher, which supports Max for Live. If you are using a version below Suite, or if you want to use it in other apps, you can download the effect as a MIDI file from the Compass web version.

1. Run the appropriate installer for your operating system to install Compass, then launch the app.
2. Open Ableton Live and add `CompassBridge-vX.X.X.amxd` to a MIDI track (highly recommended to use the bridge version that matches your Compass app version).
3. When you change the BPM in Ableton Live, it will automatically sync with the Compass app.
4. Drag and drop devices from the browser on the left to build your rack, and check out the effect in the preview on the right.
5. In Ableton Live, select the MIDI clip you want to replace, or if you don't have a clip yet, click on the desired location on the track, then press the `Send` button in Compass.

> [!IMPORTANT]
> The macOS app does not have a developer signature. After installation, you must run the following command in the Terminal for the app to launch properly.
```sh
xattr -dr com.apple.quarantine /Applications/Compass.app
```

## Development Environment

Requirements:

- Node.js `24.13.1`
- npm `11.5.1`

Install:

```sh
npm ci
```

Run Electron app:

```sh
npm start
```

Run in web browser:

```sh
npm run web:dev
```