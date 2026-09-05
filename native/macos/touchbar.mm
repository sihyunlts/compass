#include <node_api.h>

#import <AppKit/AppKit.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <vector>

static NSTouchBarItemIdentifier const kPlayItemIdentifier =
    @"com.sihyunlights.compass.touchbar.play";
static NSTouchBarItemIdentifier const kLoopItemIdentifier =
    @"com.sihyunlights.compass.touchbar.loop";
static NSTouchBarItemIdentifier const kSliderItemIdentifier =
    @"com.sihyunlights.compass.touchbar.slider";
static NSTouchBarItemIdentifier const kDurationItemIdentifier =
    @"com.sihyunlights.compass.touchbar.duration";
static NSTouchBarItemIdentifier const kDurationLabelItemIdentifier =
    @"com.sihyunlights.compass.touchbar.duration-label";
static NSTouchBarItemIdentifier const kDurationOptionsItemIdentifier =
    @"com.sihyunlights.compass.touchbar.duration-options";
static NSTouchBarItemIdentifier const kSendItemIdentifier =
    @"com.sihyunlights.compass.touchbar.send";

static napi_value Undefined(napi_env env) {
  napi_value value;
  napi_get_undefined(env, &value);
  return value;
}

static NSString *StringFromValue(napi_env env, napi_value value,
                                 NSString *fallback) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string) {
    return fallback;
  }

  size_t size = 0;
  napi_get_value_string_utf8(env, value, nullptr, 0, &size);
  std::vector<char> buffer(size + 1);
  if (napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(),
                                 &size) != napi_ok) {
    return fallback;
  }

  return [NSString stringWithUTF8String:buffer.data()] ?: fallback;
}

static NSString *StringProperty(napi_env env, napi_value object,
                                const char *key, NSString *fallback) {
  napi_value property;
  if (napi_get_named_property(env, object, key, &property) != napi_ok) {
    return fallback;
  }

  return StringFromValue(env, property, fallback);
}

static bool BoolProperty(napi_env env, napi_value object, const char *key,
                         bool fallback) {
  napi_value property;
  if (napi_get_named_property(env, object, key, &property) != napi_ok) {
    return fallback;
  }

  napi_valuetype type;
  if (napi_typeof(env, property, &type) != napi_ok || type != napi_boolean) {
    return fallback;
  }

  bool value = fallback;
  napi_get_value_bool(env, property, &value);
  return value;
}

static double NumberProperty(napi_env env, napi_value object, const char *key,
                             double fallback) {
  napi_value property;
  if (napi_get_named_property(env, object, key, &property) != napi_ok) {
    return fallback;
  }

  napi_valuetype type;
  if (napi_typeof(env, property, &type) != napi_ok || type != napi_number) {
    return fallback;
  }

  double value = fallback;
  napi_get_value_double(env, property, &value);
  return value;
}

static NSDictionary<NSString *, NSString *> *LabelsFromValue(napi_env env,
                                                             napi_value value) {
  return @{
    @"play" : StringProperty(env, value, "play", @"Play preview"),
    @"pause" : StringProperty(env, value, "pause", @"Pause preview"),
    @"enableLoop" :
        StringProperty(env, value, "enableLoop", @"Enable preview loop"),
    @"disableLoop" :
        StringProperty(env, value, "disableLoop", @"Disable preview loop"),
    @"duration" : StringProperty(env, value, "duration", @"Duration"),
    @"send" : StringProperty(env, value, "send", @"Send"),
  };
}

static NSArray<NSString *> *StringArrayFromValue(napi_env env,
                                                 napi_value value) {
  bool isArray = false;
  if (napi_is_array(env, value, &isArray) != napi_ok || !isArray) {
    return @[];
  }

  uint32_t length = 0;
  napi_get_array_length(env, value, &length);

  NSMutableArray<NSString *> *result =
      [NSMutableArray arrayWithCapacity:length];

  for (uint32_t index = 0; index < length; ++index) {
    napi_value entry;
    if (napi_get_element(env, value, index, &entry) != napi_ok) {
      continue;
    }

    NSString *stringValue = StringFromValue(env, entry, nil);
    if (stringValue) {
      [result addObject:stringValue];
    }
  }

  return result;
}

static NSData *CopyFrameData(napi_env env, napi_value value,
                             const int64_t *dimensions,
                             size_t dimensionCount,
                             bool firstDimensionMayBeZero) {
  bool isBuffer = false;
  if (napi_is_buffer(env, value, &isBuffer) != napi_ok || !isBuffer) {
    napi_throw_type_error(env, nullptr, "frame data must be a Buffer");
    return nil;
  }

  size_t requiredLength = 3;
  for (size_t index = 0; index < dimensionCount; ++index) {
    const int64_t dimension = dimensions[index];
    const int64_t minimum = firstDimensionMayBeZero && index == 0 ? 0 : 1;
    if (dimension < minimum ||
        static_cast<uint64_t>(dimension) >
            static_cast<uint64_t>(std::numeric_limits<NSInteger>::max())) {
      napi_throw_range_error(env, nullptr, "invalid frame dimensions");
      return nil;
    }

    const size_t size = static_cast<size_t>(dimension);
    if (size > 0 &&
        requiredLength > std::numeric_limits<size_t>::max() / size) {
      napi_throw_range_error(env, nullptr, "frame dimensions are too large");
      return nil;
    }
    requiredLength *= size;
  }

  if (requiredLength / 3 >
      static_cast<size_t>(std::numeric_limits<NSInteger>::max())) {
    napi_throw_range_error(env, nullptr, "frame dimensions are too large");
    return nil;
  }

  void *bufferData = nullptr;
  size_t bufferLength = 0;
  if (napi_get_buffer_info(env, value, &bufferData, &bufferLength) != napi_ok ||
      bufferLength < requiredLength) {
    napi_throw_range_error(env, nullptr, "frame Buffer is too small");
    return nil;
  }

  return requiredLength > 0
             ? [NSData dataWithBytes:bufferData length:requiredLength]
             : [NSData data];
}

@protocol CompassTouchBarFrameSource <NSObject>
@property(nonatomic, strong, readonly) NSData *currentFrameData;
@property(nonatomic, readonly) NSInteger currentFrameColumns;
@property(nonatomic, readonly) NSInteger currentFrameRows;
@property(nonatomic, readonly) NSRect timelineContentRect;
@end

@interface CompassTouchBarSliderCell : NSSliderCell {
@private
  CGFloat _knobMorph;
  CGFloat _knobMorphFrom;
  CGFloat _knobMorphTo;
  NSTimeInterval _knobMorphStart;
  NSTimeInterval _knobMorphDuration;
  NSTimer *_knobMorphTimer;
  __weak NSView *_knobControlView;
}
@end

@implementation CompassTouchBarSliderCell

- (void)dealloc {
  [_knobMorphTimer invalidate];
}

- (void)drawBarInside:(NSRect)rect flipped:(BOOL)flipped {
  // Preview frames replace the standard slider track.
}

- (void)animateKnobTo:(CGFloat)target inView:(NSView *)controlView {
  [_knobMorphTimer invalidate];
  _knobMorphTimer = nil;

  _knobControlView = controlView;
  _knobMorphFrom = _knobMorph;
  _knobMorphTo = MAX(0.0, MIN(1.0, target));
  _knobMorphStart = [NSDate timeIntervalSinceReferenceDate];

  _knobMorphDuration = _knobMorphTo > _knobMorphFrom ? 0.10 : 0.15;

  if (fabs(_knobMorphTo - _knobMorphFrom) < 0.001) {
    _knobMorph = _knobMorphTo;
    [controlView setNeedsDisplay:YES];
    return;
  }

  _knobMorphTimer = [NSTimer timerWithTimeInterval:(1.0 / 60.0)
                                            target:self
                                          selector:@selector(knobMorphTick:)
                                          userInfo:nil
                                           repeats:YES];

  [[NSRunLoop mainRunLoop] addTimer:_knobMorphTimer
                            forMode:NSRunLoopCommonModes];
}

- (void)knobMorphTick:(NSTimer *)timer {
  NSTimeInterval now = [NSDate timeIntervalSinceReferenceDate];

  CGFloat t = (now - _knobMorphStart) / _knobMorphDuration;
  t = MAX(0.0, MIN(1.0, t));

  CGFloat inverse = 1.0 - t;
  CGFloat eased = 1.0 - inverse * inverse * inverse;

  _knobMorph = _knobMorphFrom + (_knobMorphTo - _knobMorphFrom) * eased;

  [_knobControlView setNeedsDisplay:YES];

  if (t >= 1.0) {
    _knobMorph = _knobMorphTo;
    [_knobMorphTimer invalidate];
    _knobMorphTimer = nil;
    [_knobControlView setNeedsDisplay:YES];
  }
}

- (BOOL)startTrackingAt:(NSPoint)startPoint inView:(NSView *)controlView {
  [self animateKnobTo:1.0 inView:controlView];
  return [super startTrackingAt:startPoint inView:controlView];
}

- (void)stopTracking:(NSPoint)lastPoint
                  at:(NSPoint)stopPoint
              inView:(NSView *)controlView
           mouseIsUp:(BOOL)flag {
  [super stopTracking:lastPoint at:stopPoint inView:controlView mouseIsUp:flag];

  [self animateKnobTo:0.0 inView:controlView];
}

- (void)drawCurrentFrameFromSource:(id<CompassTouchBarFrameSource>)source
                            inRect:(NSRect)rect
                           flipped:(BOOL)flipped {
  NSData *data = source.currentFrameData;
  NSInteger columns = source.currentFrameColumns;
  NSInteger rows = source.currentFrameRows;

  if (!data || columns <= 0 || rows <= 0) {
    return;
  }

  const NSUInteger bytesPerCell = 3;
  const NSUInteger cellCount = static_cast<NSUInteger>(columns * rows);
  const NSUInteger requiredBytes = cellCount * bytesPerCell;

  if (data.length < requiredBytes) {
    return;
  }

  CGFloat cellSize = MIN(NSWidth(rect) / columns, NSHeight(rect) / rows);
  if (cellSize <= 0.0) {
    return;
  }

  const uint8_t *bytes = static_cast<const uint8_t *>(data.bytes);

  CGFloat gridWidth = cellSize * columns;
  CGFloat gridHeight = cellSize * rows;
  CGFloat startX = NSMidX(rect) - gridWidth * 0.5;
  CGFloat startY = NSMidY(rect) - gridHeight * 0.5;
  CGFloat inset = MIN(0.32, cellSize * 0.12);
  CGFloat dotRadius = MAX(0.12, cellSize * 0.20);

  for (NSInteger row = 0; row < rows; ++row) {
    for (NSInteger column = 0; column < columns; ++column) {
      NSUInteger cellIndex = static_cast<NSUInteger>(row * columns + column);
      NSUInteger offset = cellIndex * bytesPerCell;

      uint8_t red = bytes[offset];
      uint8_t green = bytes[offset + 1];
      uint8_t blue = bytes[offset + 2];

      if (red == 0 && green == 0 && blue == 0) {
        [[NSColor colorWithWhite:0.16 alpha:1.0] setFill];
      } else {
        [[NSColor colorWithSRGBRed:red / 255.0
                             green:green / 255.0
                              blue:blue / 255.0
                             alpha:1.0] setFill];
      }

      NSRect cellRect = NSMakeRect(
          startX + column * cellSize + inset,
          startY + (flipped ? row : (rows - 1 - row)) * cellSize + inset,
          MAX(0.20, cellSize - inset * 2.0), MAX(0.20, cellSize - inset * 2.0));

      [[NSBezierPath bezierPathWithRoundedRect:cellRect
                                       xRadius:dotRadius
                                       yRadius:dotRadius] fill];
    }
  }
}

- (void)drawKnob:(NSRect)knobRect {
  NSView *controlView = self.controlView;
  if (!controlView) {
    [super drawKnob:knobRect];
    return;
  }

  NSRect bounds = controlView.bounds;
  NSRect scrubRect = bounds;

  if ([controlView conformsToProtocol:@protocol(CompassTouchBarFrameSource)]) {
    id<CompassTouchBarFrameSource> source =
        (id<CompassTouchBarFrameSource>)controlView;

    NSRect candidate = source.timelineContentRect;
    if (NSWidth(candidate) > 0.0 && NSHeight(candidate) > 0.0) {
      scrubRect = NSIntersectionRect(bounds, candidate);
    }
  }

  CGFloat scrubWidth = NSWidth(scrubRect);
  if (scrubWidth <= 0.0 || NSHeight(scrubRect) <= 0.0 ||
      NSWidth(knobRect) <= 0.0) {
    [super drawKnob:knobRect];
    return;
  }

  const CGFloat collapsedWidth = 4.0;
  // Expanded state is square: its width matches the scrubber height.
  CGFloat expandedWidth = MIN(NSHeight(scrubRect), scrubWidth);

  CGFloat currentWidth =
      collapsedWidth + (expandedWidth - collapsedWidth) * _knobMorph;
  currentWidth = MAX(collapsedWidth, MIN(expandedWidth, currentWidth));

  double range = self.maxValue - self.minValue;
  double progress =
      range > 0.0 ? (self.doubleValue - self.minValue) / range : 0.0;
  progress = MAX(0.0, MIN(1.0, progress));

  CGFloat travel = MAX(0.0, scrubWidth - currentWidth);
  CGFloat x = NSMinX(scrubRect) + travel * progress;

  NSRect adjustedRect =
      NSMakeRect(x, NSMinY(scrubRect), currentWidth, NSHeight(scrubRect));

  // Keep the collapsed playhead rounded as well. At 4 pt wide this gives it
  // a 2 pt capsule radius; as it expands the corner radius settles at 3 pt,
  // keeping the fully expanded square relatively sharp.
  CGFloat collapsedRadius = collapsedWidth * 0.5;
  CGFloat expandedRadius = 3.0;
  CGFloat radius =
      collapsedRadius + (expandedRadius - collapsedRadius) * _knobMorph;

  if (_knobMorph <= 0.001) {
    NSBezierPath *collapsedPath =
        [NSBezierPath bezierPathWithRoundedRect:adjustedRect
                                        xRadius:collapsedRadius
                                        yRadius:collapsedRadius];
    [[NSColor whiteColor] setFill];
    [collapsedPath fill];
    return;
  }

  // The stroke is centered on its path. With a 1.5 pt outline, inset by
  // 0.75 pt so no part of the stroke paints outside the Touch Bar bounds.
  const CGFloat outlineWidth = 1.5;
  NSRect outlineRect =
      NSInsetRect(adjustedRect, outlineWidth * 0.5, outlineWidth * 0.5);
  NSBezierPath *outline = [NSBezierPath bezierPathWithRoundedRect:outlineRect
                                                          xRadius:radius
                                                          yRadius:radius];

  [NSGraphicsContext saveGraphicsState];
  [outline addClip];

  [[NSColor colorWithWhite:0.07 alpha:1.0] setFill];
  NSRectFill(outlineRect);

  if ([controlView conformsToProtocol:@protocol(CompassTouchBarFrameSource)]) {
    id<CompassTouchBarFrameSource> source =
        (id<CompassTouchBarFrameSource>)controlView;
    NSRect frameRect = NSInsetRect(outlineRect, 1.25, 1.25);
    [self drawCurrentFrameFromSource:source
                              inRect:frameRect
                             flipped:controlView.isFlipped];
  }

  [NSGraphicsContext restoreGraphicsState];

  [[NSColor whiteColor] setStroke];
  outline.lineWidth = outlineWidth;
  [outline stroke];
}

@end

@interface CompassTouchBarSlider : NSSlider <CompassTouchBarFrameSource>
@property(nonatomic, strong) NSData *timelineFrameData;
@property(nonatomic) NSInteger timelineFrameCount;
@property(nonatomic) NSInteger timelineGridColumns;
@property(nonatomic) NSInteger timelineGridRows;
@property(nonatomic, strong) NSData *currentFrameData;
@property(nonatomic) NSInteger currentFrameColumns;
@property(nonatomic) NSInteger currentFrameRows;
@property(nonatomic) NSRect timelineContentRect;
- (void)setTimelineFrameData:(NSData *)data
                  frameCount:(NSInteger)frameCount
                     columns:(NSInteger)columns
                        rows:(NSInteger)rows;
- (void)setCurrentFrameData:(NSData *)data
                    columns:(NSInteger)columns
                       rows:(NSInteger)rows;
@end

@implementation CompassTouchBarSlider

+ (Class)cellClass {
  return [CompassTouchBarSliderCell class];
}

- (NSSize)intrinsicContentSize {
  NSSize size = [super intrinsicContentSize];
  size.height = 30.0;
  return size;
}

- (NSEdgeInsets)alignmentRectInsets {
  return (NSEdgeInsets){0, 0, 0, 0};
}

- (void)setTimelineFrameData:(NSData *)data
                  frameCount:(NSInteger)frameCount
                     columns:(NSInteger)columns
                        rows:(NSInteger)rows {
  self.timelineFrameData = data ?: [NSData data];
  self.timelineFrameCount = MAX(0, frameCount);
  self.timelineGridColumns = MAX(0, columns);
  self.timelineGridRows = MAX(0, rows);
  [self setNeedsDisplay:YES];
}

- (void)setCurrentFrameData:(NSData *)data
                    columns:(NSInteger)columns
                       rows:(NSInteger)rows {
  self.currentFrameData = data ?: [NSData data];
  self.currentFrameColumns = MAX(0, columns);
  self.currentFrameRows = MAX(0, rows);
  [self setNeedsDisplay:YES];
}

- (void)drawRect:(NSRect)dirtyRect {
  NSRect bounds = self.bounds;
  self.timelineContentRect = bounds;

  if (NSWidth(bounds) <= 0.0 || NSHeight(bounds) <= 0.0) {
    [super drawRect:dirtyRect];
    return;
  }

  NSInteger frameCount = self.timelineFrameCount;
  NSInteger columns = self.timelineGridColumns;
  NSInteger rows = self.timelineGridRows;
  NSData *data = self.timelineFrameData;

  if (frameCount > 0 && columns > 0 && rows > 0 && data.length > 0) {
    const NSUInteger bytesPerCell = 3;
    const NSUInteger cellsPerFrame = static_cast<NSUInteger>(columns * rows);
    const NSUInteger bytesPerFrame = cellsPerFrame * bytesPerCell;
    const NSUInteger requiredBytes =
        static_cast<NSUInteger>(frameCount) * bytesPerFrame;

    if (data.length >= requiredBytes) {
      const uint8_t *bytes = static_cast<const uint8_t *>(data.bytes);

      // Keep timeline previews visually separate even when localization or
      // system controls leave the scrubber with very little horizontal room.
      const CGFloat minimumFrameGap = 6.0;
      CGFloat availableWidth = NSWidth(bounds);
      CGFloat availableHeight = MAX(1.0, NSHeight(bounds) - 2.0);

      // A 10x10 frame is ideally square and uses as much of the available
      // Touch Bar height as possible. Reduce the number of visible samples
      // before shrinking frames into each other.
      CGFloat preferredCellSize = availableHeight / rows;
      CGFloat preferredGridWidth = preferredCellSize * columns;

      NSInteger visibleFrameCount =
          static_cast<NSInteger>(floor((availableWidth + minimumFrameGap) /
                                       (preferredGridWidth + minimumFrameGap)));
      visibleFrameCount = MAX(1, MIN(frameCount, visibleFrameCount));

      // Guarantee at least 6 pt between neighboring frame grids. If even the
      // reduced count cannot fit at full height, shrink all visible grids
      // uniformly while preserving that gap.
      CGFloat widthForGrids =
          MAX(1.0, availableWidth - minimumFrameGap * (visibleFrameCount - 1));
      CGFloat maxGridWidth = widthForGrids / visibleFrameCount;

      CGFloat cellSize = MIN(availableHeight / rows, maxGridWidth / columns);
      cellSize = MAX(0.35, cellSize);

      CGFloat gridWidth = cellSize * columns;
      CGFloat gridHeight = cellSize * rows;
      CGFloat totalWidth = gridWidth * visibleFrameCount +
                           minimumFrameGap * (visibleFrameCount - 1);
      CGFloat firstFrameX = NSMidX(bounds) - totalWidth * 0.5;

      // The Touch Bar item still owns the full flexible layout slot, but the
      // actual scrub range ends exactly where the visible frame strip ends.
      // This prevents the thumb from travelling through empty side margins.
      self.timelineContentRect =
          NSMakeRect(firstFrameX, NSMinY(bounds), totalWidth, NSHeight(bounds));

      CGFloat startY = NSMidY(bounds) - gridHeight * 0.5;
      CGFloat inset = MIN(0.35, cellSize * 0.12);
      CGFloat dotRadius = MAX(0.18, cellSize * 0.22);

      [NSGraphicsContext saveGraphicsState];
      [NSBezierPath clipRect:bounds];

      for (NSInteger visibleFrame = 0; visibleFrame < visibleFrameCount;
           ++visibleFrame) {
        // Evenly resample the original timeline strip so dropping frames does
        // not bias the preview toward the beginning. First and last samples
        // remain represented whenever at least two frames are visible.
        NSInteger sourceFrame = 0;
        if (visibleFrameCount == 1) {
          sourceFrame = frameCount / 2;
        } else {
          double sourcePosition = static_cast<double>(visibleFrame) *
                                  static_cast<double>(frameCount - 1) /
                                  static_cast<double>(visibleFrameCount - 1);
          sourceFrame = static_cast<NSInteger>(llround(sourcePosition));
        }

        sourceFrame = MAX(0, MIN(frameCount - 1, sourceFrame));

        CGFloat startX =
            firstFrameX + visibleFrame * (gridWidth + minimumFrameGap);
        NSUInteger frameOffset =
            static_cast<NSUInteger>(sourceFrame) * bytesPerFrame;

        for (NSInteger row = 0; row < rows; ++row) {
          for (NSInteger column = 0; column < columns; ++column) {
            NSUInteger cellIndex =
                static_cast<NSUInteger>(row * columns + column);
            NSUInteger offset = frameOffset + cellIndex * bytesPerCell;

            uint8_t red = bytes[offset];
            uint8_t green = bytes[offset + 1];
            uint8_t blue = bytes[offset + 2];

            // Draw every physical pad. Unlit pads keep a subtle button
            // background, while the scrubber itself remains transparent.
            if (red == 0 && green == 0 && blue == 0) {
              [[NSColor colorWithWhite:0.16 alpha:1.0] setFill];
            } else {
              [[NSColor colorWithSRGBRed:red / 255.0
                                   green:green / 255.0
                                    blue:blue / 255.0
                                   alpha:1.0] setFill];
            }

            NSRect cellRect = NSMakeRect(
                startX + column * cellSize + inset,
                startY + (self.isFlipped ? row : (rows - 1 - row)) * cellSize +
                    inset,
                MAX(0.25, cellSize - inset * 2.0),
                MAX(0.25, cellSize - inset * 2.0));

            [[NSBezierPath bezierPathWithRoundedRect:cellRect
                                             xRadius:dotRadius
                                             yRadius:dotRadius] fill];
          }
        }
      }

      [NSGraphicsContext restoreGraphicsState];
    }
  }

  // NSSliderCell draws the native knob; drawBarInside: is empty.
  [super drawRect:dirtyRect];
}

@end

@interface CompassTouchBarController : NSObject <NSTouchBarDelegate> {
@private
  napi_env _env;
  napi_ref _callbackRef;
}

@property(nonatomic, weak) NSWindow *window;
@property(nonatomic, strong) NSTouchBar *mainTouchBar;
@property(nonatomic, strong) NSTouchBar *durationTouchBar;
@property(nonatomic, strong) NSButtonTouchBarItem *playItem;
@property(nonatomic, strong) NSButtonTouchBarItem *loopItem;
@property(nonatomic, strong) NSCustomTouchBarItem *sliderItem;
@property(nonatomic, strong) CompassTouchBarSlider *sliderControl;
@property(nonatomic, strong) NSPopoverTouchBarItem *durationItem;
@property(nonatomic, strong) NSCustomTouchBarItem *durationLabelItem;
@property(nonatomic, strong) NSTextField *durationLabelField;
@property(nonatomic, strong) NSCustomTouchBarItem *durationOptionsItem;
@property(nonatomic, strong) NSSegmentedControl *durationControl;
@property(nonatomic, strong) NSButtonTouchBarItem *sendItem;
@property(nonatomic, copy) NSDictionary<NSString *, NSString *> *labels;
@property(nonatomic, copy) NSArray<NSString *> *durationOptions;
@property(nonatomic) BOOL isPlaying;
@property(nonatomic) BOOL isLoopEnabled;
@property(nonatomic) double scrubMax;

- (instancetype)initWithWindow:(NSWindow *)window
                           env:(napi_env)env
                   callbackRef:(napi_ref)callbackRef
                        labels:(NSDictionary<NSString *, NSString *> *)labels
               durationOptions:(NSArray<NSString *> *)durationOptions
                      scrubMax:(double)scrubMax;
- (void)updateWithPlaying:(BOOL)isPlaying
                     loop:(BOOL)isLoopEnabled
               scrubValue:(double)scrubValue
                 duration:(NSString *)duration;
- (void)setTimelineFrameData:(NSData *)data
                  frameCount:(NSInteger)frameCount
                     columns:(NSInteger)columns
                        rows:(NSInteger)rows;
- (void)setCurrentFrameData:(NSData *)data
                    columns:(NSInteger)columns
                       rows:(NSInteger)rows;
- (void)updateLabels:(NSDictionary<NSString *, NSString *> *)labels;
- (void)emitAction:(NSString *)action value:(id)value;
- (void)dispose;

@end

@implementation CompassTouchBarController

- (instancetype)initWithWindow:(NSWindow *)window
                           env:(napi_env)env
                   callbackRef:(napi_ref)callbackRef
                        labels:(NSDictionary<NSString *, NSString *> *)labels
               durationOptions:(NSArray<NSString *> *)durationOptions
                      scrubMax:(double)scrubMax {
  self = [super init];
  if (!self) {
    return nil;
  }

  _env = env;
  _callbackRef = callbackRef;
  self.window = window;
  self.labels = labels;
  self.durationOptions = durationOptions;
  self.scrubMax = std::max(1.0, scrubMax);
  self.isPlaying = NO;
  self.isLoopEnabled = NO;

  [self buildItems];
  [self buildTouchBars];

  self.window.touchBar = self.mainTouchBar;

  return self;
}

- (NSImage *)symbolImageNamed:(NSString *)name
            accessibilityText:(NSString *)accessibilityText {
  NSImage *image = [NSImage imageWithSystemSymbolName:name
                             accessibilityDescription:accessibilityText];
  [image setTemplate:YES];
  return image;
}

- (NSImage *)playImage {
  return [self symbolImageNamed:(self.isPlaying ? @"pause.fill" : @"play.fill")
              accessibilityText:(self.isPlaying ? self.labels[@"pause"]
                                                : self.labels[@"play"])];
}

- (NSImage *)loopImage {
  NSString *symbolName = self.isLoopEnabled ? @"repeat" : @"repeat.badge.xmark";

  NSString *accessibilityText = self.isLoopEnabled ? self.labels[@"disableLoop"]
                                                   : self.labels[@"enableLoop"];

  NSImage *image = [NSImage imageWithSystemSymbolName:symbolName
                             accessibilityDescription:accessibilityText];

  // Fallback for macOS versions where repeat.badge.xmark
  // might not be available.
  if (!image) {
    image = [NSImage imageWithSystemSymbolName:@"repeat"
                      accessibilityDescription:accessibilityText];
  }

  [image setTemplate:YES];
  return image;
}

- (void)refreshPlayItem {
  self.playItem.image = [self playImage];
  self.playItem.customizationLabel =
      self.isPlaying ? self.labels[@"pause"] : self.labels[@"play"];
}

- (void)refreshLoopItem {
  self.loopItem.image = [self loopImage];
  self.loopItem.customizationLabel = self.isLoopEnabled
                                         ? self.labels[@"disableLoop"]
                                         : self.labels[@"enableLoop"];
}

- (void)buildItems {
  self.playItem = [NSButtonTouchBarItem
      buttonTouchBarItemWithIdentifier:kPlayItemIdentifier
                                 image:[self playImage]
                                target:self
                                action:@selector(playPressed:)];
  self.playItem.customizationLabel = self.labels[@"play"];

  self.loopItem = [NSButtonTouchBarItem
      buttonTouchBarItemWithIdentifier:kLoopItemIdentifier
                                 image:[self loopImage]
                                target:self
                                action:@selector(loopPressed:)];
  self.loopItem.customizationLabel = self.isLoopEnabled
                                         ? self.labels[@"disableLoop"]
                                         : self.labels[@"enableLoop"];

  self.sliderItem =
      [[NSCustomTouchBarItem alloc] initWithIdentifier:kSliderItemIdentifier];

  // Use a custom Touch Bar item so AppKit does not add the native
  // NSSliderTouchBarItem chrome behind the scrubber. The timeline frames,
  // custom knob, 30 pt height, and seek interaction are all drawn/handled by
  // CompassTouchBarSlider itself.
  self.sliderControl =
      [CompassTouchBarSlider sliderWithValue:0
                                    minValue:0
                                    maxValue:self.scrubMax
                                      target:self
                                      action:@selector(sliderChanged:)];

  self.sliderControl.controlSize = NSControlSizeRegular;
  self.sliderControl.continuous = YES;
  self.sliderControl.translatesAutoresizingMaskIntoConstraints = NO;

  // Let the custom scrubber absorb otherwise-unused Touch Bar width.
  // There is deliberately no fixed or maximum width here.
  [self.sliderControl
      setContentHuggingPriority:1.0
                 forOrientation:NSLayoutConstraintOrientationHorizontal];
  [self.sliderControl
      setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow
                               forOrientation:
                                   NSLayoutConstraintOrientationHorizontal];

  [NSLayoutConstraint activateConstraints:@[
    [self.sliderControl.widthAnchor
        constraintGreaterThanOrEqualToConstant:180.0],
    [self.sliderControl.heightAnchor constraintEqualToConstant:30.0],
  ]];

  self.sliderItem.view = self.sliderControl;

  self.durationLabelField =
      [NSTextField labelWithString:(self.labels[@"duration"] ?: @"Duration")];
  self.durationLabelItem = [[NSCustomTouchBarItem alloc]
      initWithIdentifier:kDurationLabelItemIdentifier];
  self.durationLabelItem.view = self.durationLabelField;

  self.durationControl = [NSSegmentedControl
      segmentedControlWithLabels:self.durationOptions
                    trackingMode:NSSegmentSwitchTrackingSelectOne
                          target:self
                          action:@selector(durationChanged:)];
  self.durationControl.segmentStyle = NSSegmentStyleAutomatic;
  self.durationControl.selectedSegment = 0;

  self.durationOptionsItem = [[NSCustomTouchBarItem alloc]
      initWithIdentifier:kDurationOptionsItemIdentifier];
  self.durationOptionsItem.view = self.durationControl;

  self.durationItem = [[NSPopoverTouchBarItem alloc]
      initWithIdentifier:kDurationItemIdentifier];
  self.durationItem.collapsedRepresentationLabel = self.durationOptions.firstObject;
  self.durationItem.showsCloseButton = YES;

  self.sendItem = [NSButtonTouchBarItem
      buttonTouchBarItemWithIdentifier:kSendItemIdentifier
                                 title:self.labels[@"send"]
                                 image:[self symbolImageNamed:@"paperplane.fill"
                                            accessibilityText:self.labels
                                                                  [@"send"]]
                                target:self
                                action:@selector(sendPressed:)];
  self.sendItem.customizationLabel = self.labels[@"send"];
}
- (void)buildTouchBars {
  self.durationTouchBar = [[NSTouchBar alloc] init];
  self.durationTouchBar.delegate = self;
  self.durationTouchBar.defaultItemIdentifiers = @[
    kDurationLabelItemIdentifier,
    NSTouchBarItemIdentifierFixedSpaceSmall,
    kDurationOptionsItemIdentifier,
  ];

  self.durationItem.popoverTouchBar = self.durationTouchBar;
  self.durationItem.pressAndHoldTouchBar = self.durationTouchBar;

  self.mainTouchBar = [[NSTouchBar alloc] init];
  self.mainTouchBar.delegate = self;
  self.mainTouchBar.defaultItemIdentifiers = @[
    kPlayItemIdentifier,
    kLoopItemIdentifier,
    kSliderItemIdentifier,
    kDurationItemIdentifier,
    kSendItemIdentifier,
    NSTouchBarItemIdentifierOtherItemsProxy,
  ];
}

- (NSTouchBarItem *)touchBar:(NSTouchBar *)touchBar
       makeItemForIdentifier:(NSTouchBarItemIdentifier)identifier {
  if ([identifier isEqualToString:kPlayItemIdentifier]) {
    return self.playItem;
  }
  if ([identifier isEqualToString:kLoopItemIdentifier]) {
    return self.loopItem;
  }
  if ([identifier isEqualToString:kSliderItemIdentifier]) {
    return self.sliderItem;
  }
  if ([identifier isEqualToString:kDurationItemIdentifier]) {
    return self.durationItem;
  }
  if ([identifier isEqualToString:kDurationLabelItemIdentifier]) {
    return self.durationLabelItem;
  }
  if ([identifier isEqualToString:kDurationOptionsItemIdentifier]) {
    return self.durationOptionsItem;
  }
  if ([identifier isEqualToString:kSendItemIdentifier]) {
    return self.sendItem;
  }
  return nil;
}

- (void)emitAction:(NSString *)action value:(id)value {
  if (!_callbackRef) {
    return;
  }

  napi_handle_scope scope;
  if (napi_open_handle_scope(_env, &scope) != napi_ok) {
    return;
  }

  napi_value callback;
  napi_value receiver;
  if (napi_get_reference_value(_env, _callbackRef, &callback) != napi_ok ||
      napi_get_global(_env, &receiver) != napi_ok) {
    napi_close_handle_scope(_env, scope);
    return;
  }

  napi_value argv[2];
  size_t argc = 1;

  const char *actionUtf8 = action.UTF8String;
  napi_create_string_utf8(_env, actionUtf8, NAPI_AUTO_LENGTH, &argv[0]);

  if ([value isKindOfClass:[NSNumber class]]) {
    napi_create_double(_env, [value doubleValue], &argv[1]);
    argc = 2;
  } else if ([value isKindOfClass:[NSString class]]) {
    napi_create_string_utf8(_env, [value UTF8String], NAPI_AUTO_LENGTH,
                            &argv[1]);
    argc = 2;
  }

  napi_value ignored;
  napi_call_function(_env, receiver, callback, argc, argv, &ignored);

  napi_close_handle_scope(_env, scope);
}

- (void)playPressed:(id)sender {
  [self emitAction:@"play" value:nil];
}

- (void)loopPressed:(id)sender {
  [self emitAction:@"loop" value:nil];
}

- (void)sendPressed:(id)sender {
  [self emitAction:@"send" value:nil];
}

- (void)sliderChanged:(NSSlider *)sender {
  [self emitAction:@"seek" value:@(sender.doubleValue)];
}

- (void)durationChanged:(NSSegmentedControl *)sender {
  NSInteger selected = sender.selectedSegment;
  if (selected < 0 ||
      selected >= static_cast<NSInteger>(self.durationOptions.count)) {
    return;
  }

  [self emitAction:@"duration"
             value:self.durationOptions[static_cast<NSUInteger>(selected)]];
}

- (void)updateWithPlaying:(BOOL)isPlaying
                     loop:(BOOL)isLoopEnabled
               scrubValue:(double)scrubValue
                 duration:(NSString *)duration {
  BOOL playChanged = self.isPlaying != isPlaying;
  BOOL loopChanged = self.isLoopEnabled != isLoopEnabled;

  self.isPlaying = isPlaying;
  self.isLoopEnabled = isLoopEnabled;

  if (playChanged) {
    [self refreshPlayItem];
  }

  if (loopChanged) {
    [self refreshLoopItem];
  }

  self.sliderControl.doubleValue =
      std::max(0.0, std::min(self.scrubMax, scrubValue));

  if (duration.length > 0) {
    self.durationItem.collapsedRepresentationLabel = duration;
    NSUInteger index = [self.durationOptions indexOfObject:duration];
    if (index != NSNotFound) {
      self.durationControl.selectedSegment = static_cast<NSInteger>(index);
    }
  }
}

- (void)setTimelineFrameData:(NSData *)data
                  frameCount:(NSInteger)frameCount
                     columns:(NSInteger)columns
                        rows:(NSInteger)rows {
  [self.sliderControl setTimelineFrameData:data
                                frameCount:frameCount
                                   columns:columns
                                      rows:rows];
}

- (void)setCurrentFrameData:(NSData *)data
                    columns:(NSInteger)columns
                       rows:(NSInteger)rows {
  [self.sliderControl setCurrentFrameData:data columns:columns rows:rows];
}

- (void)updateLabels:(NSDictionary<NSString *, NSString *> *)labels {
  self.labels = labels;

  [self refreshPlayItem];
  [self refreshLoopItem];

  self.durationLabelField.stringValue = self.labels[@"duration"] ?: @"Duration";

  self.sendItem.title = self.labels[@"send"];
  self.sendItem.image = [self symbolImageNamed:@"paperplane.fill"
                             accessibilityText:self.labels[@"send"]];
  self.sendItem.customizationLabel = self.labels[@"send"];
}

- (void)dispose {
  if (self.window.touchBar == self.mainTouchBar) {
    self.window.touchBar = nil;
  }

  if (_callbackRef) {
    napi_delete_reference(_env, _callbackRef);
    _callbackRef = nullptr;
  }
}

@end

static CompassTouchBarController *gController = nil;

static napi_value Install(napi_env env, napi_callback_info info) {
  size_t argc = 5;
  napi_value argv[5];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  if (argc < 5) {
    napi_throw_type_error(env, nullptr,
                          "install requires window handle, callback, labels, "
                          "durations, and scrub max");
    return Undefined(env);
  }

  bool isBuffer = false;
  napi_is_buffer(env, argv[0], &isBuffer);
  if (!isBuffer) {
    napi_throw_type_error(env, nullptr, "window handle must be a Buffer");
    return Undefined(env);
  }

  napi_valuetype callbackType;
  napi_typeof(env, argv[1], &callbackType);
  if (callbackType != napi_function) {
    napi_throw_type_error(env, nullptr, "callback must be a function");
    return Undefined(env);
  }

  void *bufferData = nullptr;
  size_t bufferLength = 0;
  napi_get_buffer_info(env, argv[0], &bufferData, &bufferLength);
  if (!bufferData || bufferLength < sizeof(void *)) {
    napi_throw_type_error(env, nullptr, "invalid native window handle");
    return Undefined(env);
  }

  void *viewPointer = nullptr;
  std::memcpy(&viewPointer, bufferData, sizeof(void *));

  NSView *view = (__bridge NSView *)viewPointer;
  NSWindow *window = view.window;
  if (!window) {
    napi_throw_error(env, nullptr, "Electron native view has no NSWindow");
    return Undefined(env);
  }

  napi_ref callbackRef;
  if (napi_create_reference(env, argv[1], 1, &callbackRef) != napi_ok) {
    napi_throw_error(env, nullptr, "failed to retain Touch Bar callback");
    return Undefined(env);
  }

  NSArray<NSString *> *durationOptions = StringArrayFromValue(env, argv[3]);
  if (durationOptions.count == 0) {
    napi_delete_reference(env, callbackRef);
    napi_throw_type_error(env, nullptr, "duration options cannot be empty");
    return Undefined(env);
  }

  double scrubMax = 1000;
  napi_get_value_double(env, argv[4], &scrubMax);

  if (gController) {
    [gController dispose];
    gController = nil;
  }

  gController = [[CompassTouchBarController alloc]
       initWithWindow:window
                  env:env
          callbackRef:callbackRef
               labels:LabelsFromValue(env, argv[2])
      durationOptions:durationOptions
             scrubMax:scrubMax];

  if (!gController) {
    napi_delete_reference(env, callbackRef);
    napi_throw_error(env, nullptr, "failed to create native Touch Bar");
  }

  return Undefined(env);
}

static napi_value Update(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  if (!gController || argc < 1) {
    return Undefined(env);
  }

  BOOL isPlaying = BoolProperty(env, argv[0], "isPlaying", false);
  BOOL isLoopEnabled = BoolProperty(env, argv[0], "isLoopEnabled", false);
  double scrubValue = NumberProperty(env, argv[0], "scrubValue", 0);
  NSString *duration = StringProperty(env, argv[0], "duration", @"1/4");

  [gController updateWithPlaying:isPlaying
                            loop:isLoopEnabled
                      scrubValue:scrubValue
                        duration:duration];

  return Undefined(env);
}

static napi_value SetTimelineFrames(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value argv[4];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  if (!gController || argc < 4) {
    return Undefined(env);
  }

  int64_t frameCount = 0;
  int64_t columns = 0;
  int64_t rows = 0;
  if (napi_get_value_int64(env, argv[1], &frameCount) != napi_ok ||
      napi_get_value_int64(env, argv[2], &columns) != napi_ok ||
      napi_get_value_int64(env, argv[3], &rows) != napi_ok) {
    napi_throw_type_error(env, nullptr, "invalid timeline frame dimensions");
    return Undefined(env);
  }

  const int64_t dimensions[] = {frameCount, columns, rows};
  NSData *data = CopyFrameData(env, argv[0], dimensions, 3, true);
  if (!data) {
    return Undefined(env);
  }

  [gController setTimelineFrameData:data
                         frameCount:static_cast<NSInteger>(frameCount)
                            columns:static_cast<NSInteger>(columns)
                               rows:static_cast<NSInteger>(rows)];

  return Undefined(env);
}

static napi_value SetCurrentFrame(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  if (!gController || argc < 3) {
    return Undefined(env);
  }

  int64_t columns = 0;
  int64_t rows = 0;
  if (napi_get_value_int64(env, argv[1], &columns) != napi_ok ||
      napi_get_value_int64(env, argv[2], &rows) != napi_ok) {
    napi_throw_type_error(env, nullptr, "invalid current frame dimensions");
    return Undefined(env);
  }

  const int64_t dimensions[] = {columns, rows};
  NSData *data = CopyFrameData(env, argv[0], dimensions, 2, false);
  if (!data) {
    return Undefined(env);
  }

  [gController setCurrentFrameData:data
                           columns:static_cast<NSInteger>(columns)
                              rows:static_cast<NSInteger>(rows)];

  return Undefined(env);
}

static napi_value SetLabels(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  if (gController && argc >= 1) {
    [gController updateLabels:LabelsFromValue(env, argv[0])];
  }

  return Undefined(env);
}

static napi_value Dispose(napi_env env, napi_callback_info info) {
  if (gController) {
    [gController dispose];
    gController = nil;
  }

  return Undefined(env);
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"install", nullptr, Install, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"update", nullptr, Update, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"setTimelineFrames", nullptr, SetTimelineFrames, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"setCurrentFrame", nullptr, SetCurrentFrame, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"setLabels", nullptr, SetLabels, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"dispose", nullptr, Dispose, nullptr, nullptr, nullptr, napi_default,
       nullptr},
  };

  napi_define_properties(
      env, exports, sizeof(properties) / sizeof(properties[0]), properties);

  return exports;
}

NAPI_MODULE(compass_touchbar, Init)
