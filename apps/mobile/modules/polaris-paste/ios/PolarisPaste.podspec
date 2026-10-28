Pod::Spec.new do |s|
  s.name           = 'PolarisPaste'
  s.version        = '1.0.0'
  s.summary        = 'Pasting images into the Mobile App composers'
  s.description    = 'Lets a composer text field paste pasteboard images, which become attachments'
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
