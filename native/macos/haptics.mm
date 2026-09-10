#include <node_api.h>

#import <AppKit/AppKit.h>

static napi_value Undefined(napi_env env) {
  napi_value value;
  napi_get_undefined(env, &value);
  return value;
}

static napi_value PerformAlignment(napi_env env, napi_callback_info info) {
  [[NSHapticFeedbackManager defaultPerformer]
      performFeedbackPattern:NSHapticFeedbackPatternAlignment
             performanceTime:NSHapticFeedbackPerformanceTimeDefault];

  return Undefined(env);
}

static napi_value PerformGeneric(napi_env env, napi_callback_info info) {
  [[NSHapticFeedbackManager defaultPerformer]
      performFeedbackPattern:NSHapticFeedbackPatternGeneric
             performanceTime:NSHapticFeedbackPerformanceTimeDefault];

  return Undefined(env);
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"performAlignment", nullptr, PerformAlignment, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"performGeneric", nullptr, PerformGeneric, nullptr, nullptr, nullptr,
       napi_default, nullptr},
  };

  napi_define_properties(
      env, exports, sizeof(properties) / sizeof(properties[0]), properties);

  return exports;
}

NAPI_MODULE(compass_haptics, Init)
