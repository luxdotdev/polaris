---
status: accepted
implements: ENG-458
---

# The Mobile App is Expo React Native, with Swift where iOS insists

## Context

The Mobile App is the Desktop App's cockpit without the Editor (DESIGN.md, Mobile App), so most of
what it runs already exists in TypeScript: `packages/protocol`, `packages/client`'s Connection
State machine and resume (checked against the Quint spec), and `@polaris/ui`'s tokens. A fully
native SwiftUI app would fit the iPhone Duo best but would duplicate that verified runtime in
Swift.

## Decision

`apps/mobile` is an Expo React Native app that shares those packages with the Desktop App. Swift
is used only where iOS requires it or performance demands it: WidgetKit widgets, the Notification
Service Extension that decrypts Polaris Relay pushes, the iPhone Duo hinge and `ArrangementView`
bridge, and the diff renderer if Pierre Diffs cannot hold the frame budget in React Native.

## Consequences

- Not everything ports one-to-one: the renderer's React components are rebuilt for React Native,
  with only logic, state and tokens shared.
- Effect 4 must run on Hermes; the scaffold proves that before screens are built on it.
