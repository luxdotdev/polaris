Pod::Spec.new do |s|
  s.name           = 'PolarisSodium'
  s.version        = '0.0.0'
  s.summary        = 'libsodium for the Polaris Mobile App, in the shape sodium-universal expects'
  s.license        = 'Apache-2.0'
  s.author         = 'Polaris'
  s.homepage       = 'https://github.com/lucasdoell/polaris'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '*.swift'
  # Built by apps/mobile/scripts/buildSodium.ts (libsodium 1.0.21, pinned by SHA-256).
  s.vendored_frameworks = 'vendor/Clibsodium.xcframework'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
