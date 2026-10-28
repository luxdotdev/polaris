Pod::Spec.new do |s|
  s.name           = 'PolarisHinge'
  s.version        = '1.0.0'
  s.summary        = 'The iPhone Duo hinge and fold division for the Mobile App'
  s.description    = 'Reports the hinge status and angle and the division reserved region to React Native'
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
