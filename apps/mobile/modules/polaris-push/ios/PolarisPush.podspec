Pod::Spec.new do |s|
  s.name           = 'PolarisPush'
  s.version        = '0.0.0'
  s.summary        = 'The push key and APNs environment for Polaris push'
  s.author         = 'Polaris'
  s.homepage       = 'https://polaris.lux.dev'
  s.license        = 'Apache-2.0'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
