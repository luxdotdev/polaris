Pod::Spec.new do |s|
  s.name           = 'PolarisLiveActivity'
  s.version        = '0.0.0'
  s.summary        = 'Starts, updates and ends the aggregate Live Activity'
  s.author         = 'Polaris'
  s.homepage       = 'https://polaris.lux.dev'
  s.license        = 'Apache-2.0'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
