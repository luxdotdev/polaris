Pod::Spec.new do |s|
  s.name           = 'PolarisWidgets'
  s.version        = '1.0.0'
  s.summary        = 'Hands the widget snapshot to the WidgetKit extension'
  s.description    = 'Writes the widget snapshot to the App Group and reloads the timelines'
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
