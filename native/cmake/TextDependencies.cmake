include_guard(GLOBAL)

include(FetchContent)

set(CIRVIVOR_BROTLI_VERSION "1.2.0")
set(CIRVIVOR_BROTLI_RELEASE_TAG "v1.2.0")
set(CIRVIVOR_BROTLI_COMMIT "028fb5a23661f123017c060daa546b55cf4bde29")
set(
    CIRVIVOR_BROTLI_SOURCE_URL
    "https://github.com/google/brotli/archive/${CIRVIVOR_BROTLI_COMMIT}.tar.gz"
)
set(
    CIRVIVOR_BROTLI_SOURCE_SHA256
    "0afe09a53c8bad9861c8dd1fc1284308d54f19d2979ba3541cfdcc9b05fe360f"
)

set(CIRVIVOR_FREETYPE_VERSION "2.14.3")
set(CIRVIVOR_FREETYPE_RELEASE_TAG "VER-2-14-3")
set(CIRVIVOR_FREETYPE_COMMIT "0a0221a1347e2f1e07c395263540026e9a0aa7c7")
set(
    CIRVIVOR_FREETYPE_SOURCE_URL
    "https://download.savannah.gnu.org/releases/freetype/freetype-${CIRVIVOR_FREETYPE_VERSION}.tar.xz"
)
set(
    CIRVIVOR_FREETYPE_SOURCE_SHA256
    "36bc4f1cc413335368ee656c42afca65c5a3987e8768cc28cf11ba775e785a5f"
)

set(CIRVIVOR_HARFBUZZ_VERSION "14.2.1")
set(CIRVIVOR_HARFBUZZ_RELEASE_TAG "14.2.1")
set(CIRVIVOR_HARFBUZZ_COMMIT "56feae4035bdd48f62ba2b8d8c16232d4d89b3a4")
set(
    CIRVIVOR_HARFBUZZ_SOURCE_URL
    "https://github.com/harfbuzz/harfbuzz/releases/download/${CIRVIVOR_HARFBUZZ_RELEASE_TAG}/harfbuzz-${CIRVIVOR_HARFBUZZ_VERSION}.tar.xz"
)
set(
    CIRVIVOR_HARFBUZZ_SOURCE_SHA256
    "a54a5d8e9380a41fbb762ce367bcbf7704792dfca0d93f1bbca86c5a57902e0e"
)

# The text stack is source-built as static libraries on every platform.  These
# options intentionally avoid host packages so Android cross-builds consume the
# same Brotli -> FreeType -> HarfBuzz graph as desktop builds.
block(SCOPE_FOR VARIABLES)
set(BUILD_SHARED_LIBS OFF)
set(SKIP_INSTALL_ALL ON)

set(BROTLI_BUILD_TOOLS OFF CACHE BOOL "Build the Brotli command-line tool." FORCE)
set(BROTLI_DISABLE_TESTS ON CACHE BOOL "Disable Brotli tests." FORCE)
set(BROTLI_BUNDLED_MODE ON CACHE BOOL "Build Brotli as a bundled dependency." FORCE)

FetchContent_Declare(
    cirvivor_brotli
    URL "${CIRVIVOR_BROTLI_SOURCE_URL}"
    URL_HASH "SHA256=${CIRVIVOR_BROTLI_SOURCE_SHA256}"
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(cirvivor_brotli)

if(NOT TARGET brotlidec OR NOT TARGET brotlicommon)
    message(FATAL_ERROR "Pinned Brotli ${CIRVIVOR_BROTLI_VERSION} did not provide static decoder targets.")
endif()
set_target_properties(brotlidec brotlicommon PROPERTIES POSITION_INDEPENDENT_CODE ON)
if(TARGET brotlienc)
    set_target_properties(brotlienc PROPERTIES EXCLUDE_FROM_ALL TRUE)
endif()

# FreeType's bundled FindBrotliDec module searches host libraries by default.
# Supplying the fetched decoder target keeps WOFF2 decoding static and avoids
# silently resolving a different system Brotli during cross-compilation.
set(
    BROTLIDEC_INCLUDE_DIRS
    "${cirvivor_brotli_SOURCE_DIR}/c/include"
    CACHE PATH "Pinned Brotli decoder include directory." FORCE
)
set(
    BROTLIDEC_LIBRARIES
    "brotlidec"
    CACHE STRING "Pinned Brotli decoder target." FORCE
)

set(FT_DISABLE_ZLIB ON CACHE BOOL "Disable optional FreeType zlib support." FORCE)
set(FT_DISABLE_BZIP2 ON CACHE BOOL "Disable optional FreeType bzip2 support." FORCE)
set(FT_DISABLE_PNG ON CACHE BOOL "Disable optional FreeType PNG support." FORCE)
set(FT_DISABLE_HARFBUZZ ON CACHE BOOL "Avoid a FreeType/HarfBuzz dependency cycle." FORCE)
set(FT_DISABLE_BROTLI OFF CACHE BOOL "Enable FreeType WOFF2 support." FORCE)
set(FT_REQUIRE_BROTLI ON CACHE BOOL "Require the pinned Brotli decoder." FORCE)
set(FT_ENABLE_ERROR_STRINGS OFF CACHE BOOL "Keep FreeType's production footprint minimal." FORCE)

FetchContent_Declare(
    cirvivor_freetype
    URL "${CIRVIVOR_FREETYPE_SOURCE_URL}"
    URL_HASH "SHA256=${CIRVIVOR_FREETYPE_SOURCE_SHA256}"
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(cirvivor_freetype)

if(NOT TARGET freetype)
    message(FATAL_ERROR "Pinned FreeType ${CIRVIVOR_FREETYPE_VERSION} did not provide the freetype target.")
endif()
set_target_properties(freetype PROPERTIES POSITION_INDEPENDENT_CODE ON)
if(MSVC)
    target_compile_options(freetype PRIVATE /utf-8)
endif()

set(HB_HAVE_FREETYPE ON CACHE BOOL "Enable HarfBuzz hb-ft integration." FORCE)
set(HB_HAVE_CAIRO OFF CACHE BOOL "Disable HarfBuzz Cairo integration." FORCE)
set(HB_HAVE_GRAPHITE2 OFF CACHE BOOL "Disable HarfBuzz Graphite2 integration." FORCE)
set(HB_HAVE_GLIB OFF CACHE BOOL "Disable HarfBuzz GLib integration." FORCE)
set(HB_HAVE_ICU OFF CACHE BOOL "Disable HarfBuzz ICU integration." FORCE)
set(HB_HAVE_GOBJECT OFF CACHE BOOL "Disable HarfBuzz GObject bindings." FORCE)
set(HB_HAVE_INTROSPECTION OFF CACHE BOOL "Disable HarfBuzz introspection." FORCE)
set(HB_BUILD_UTILS OFF CACHE BOOL "Disable HarfBuzz utilities." FORCE)
set(HB_BUILD_SUBSET OFF CACHE BOOL "Disable the unused HarfBuzz subset library." FORCE)
set(HB_BUILD_RASTER OFF CACHE BOOL "Disable the unused HarfBuzz raster library." FORCE)
set(HB_BUILD_VECTOR OFF CACHE BOOL "Disable the unused HarfBuzz vector library." FORCE)
set(HB_BUILD_GPU OFF CACHE BOOL "Disable the unused HarfBuzz GPU library." FORCE)

FetchContent_Declare(
    cirvivor_harfbuzz
    URL "${CIRVIVOR_HARFBUZZ_SOURCE_URL}"
    URL_HASH "SHA256=${CIRVIVOR_HARFBUZZ_SOURCE_SHA256}"
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(cirvivor_harfbuzz)

if(NOT TARGET harfbuzz)
    message(FATAL_ERROR "Pinned HarfBuzz ${CIRVIVOR_HARFBUZZ_VERSION} did not provide the harfbuzz target.")
endif()
set_target_properties(harfbuzz PROPERTIES POSITION_INDEPENDENT_CODE ON)
endblock()
