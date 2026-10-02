# Manage language tools without owning developer toolchains

Polaris installs language tools on demand into private Host locations, either
from Settings or automatically on first encounter, and uses tested pinned
versions with explicit updates. Developers supply server runtimes and project
toolchains; Polaris reports missing requirements rather than installing runtimes
or project dependencies. This keeps the managed catalog available without
preloading every language or owning the developer's environment.
