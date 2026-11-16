Pod::Spec.new do |s|
  s.name           = 'PolarisAuthSession'
  s.version        = '1.0.0'
  s.summary        = 'Signing in to a Polaris account in the Mobile App'
  s.description    = 'Runs an Account Server sign-in in ASWebAuthenticationSession and returns its polaris:// redirect'
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
