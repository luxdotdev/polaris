Pod::Spec.new do |s|
  s.name           = 'PolarisContextMenu'
  s.version        = '1.0.0'
  s.summary        = 'Long-press menus for the Mobile App rows'
  s.description    = 'A UIContextMenuInteraction with its lifted preview around React Native children, and the pasteboard'
  s.author         = 'Polaris'
  s.homepage       = 'https://github.com/lucasdoell/polaris'
  s.license        = 'Apache-2.0'
  s.platform       = :ios, '16.4'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }

  s.source_files = '**/*.swift'
end
