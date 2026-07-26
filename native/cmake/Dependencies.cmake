include_guard(GLOBAL)

include(FetchContent)

set(CIRVIVOR_SDL3_VERSION "3.4.10")
set(CIRVIVOR_SDL3_RELEASE_TAG "release-3.4.10")
set(CIRVIVOR_SDL3_COMMIT "8e37db5e797b6167f3a00d697d816a684bd259c7")
set(
    CIRVIVOR_SDL3_SOURCE_URL
    "https://github.com/libsdl-org/SDL/releases/download/${CIRVIVOR_SDL3_RELEASE_TAG}/SDL3-${CIRVIVOR_SDL3_VERSION}.tar.gz"
)
set(
    CIRVIVOR_SDL3_SOURCE_SHA256
    "12b34280415ec8418c864408b93d008a20a6530687ee613d60bfbd20411f2785"
)

# CirVivor ships one pinned SDL implementation. Building only the static target
# avoids an untracked runtime DLL beside the first desktop shell executable.
set(SDL_SHARED OFF CACHE BOOL "Build SDL as a shared library." FORCE)
set(SDL_STATIC ON CACHE BOOL "Build SDL as a static library." FORCE)
set(SDL_TEST_LIBRARY OFF CACHE BOOL "Build the SDL test library." FORCE)
set(SDL_TESTS OFF CACHE BOOL "Build SDL tests." FORCE)
set(SDL_EXAMPLES OFF CACHE BOOL "Build SDL examples." FORCE)
set(SDL_INSTALL OFF CACHE BOOL "Generate SDL install rules." FORCE)
set(SDL_WERROR OFF CACHE BOOL "Treat SDL warnings as errors." FORCE)

FetchContent_Declare(
    cirvivor_sdl3
    URL "${CIRVIVOR_SDL3_SOURCE_URL}"
    URL_HASH "SHA256=${CIRVIVOR_SDL3_SOURCE_SHA256}"
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)

FetchContent_MakeAvailable(cirvivor_sdl3)

if(NOT TARGET SDL3::SDL3)
    message(FATAL_ERROR "Pinned SDL ${CIRVIVOR_SDL3_VERSION} did not provide SDL3::SDL3.")
endif()

set(_cirvivor_sdl3_revision_file "${cirvivor_sdl3_SOURCE_DIR}/.git-hash")
if(NOT EXISTS "${_cirvivor_sdl3_revision_file}")
    message(FATAL_ERROR "Pinned SDL source is missing its embedded .git-hash revision.")
endif()
file(STRINGS "${_cirvivor_sdl3_revision_file}" _cirvivor_sdl3_revision LIMIT_COUNT 1)
if(NOT _cirvivor_sdl3_revision STREQUAL CIRVIVOR_SDL3_COMMIT)
    message(FATAL_ERROR
        "Pinned SDL revision mismatch: expected ${CIRVIVOR_SDL3_COMMIT}, "
        "found ${_cirvivor_sdl3_revision}."
    )
endif()
unset(_cirvivor_sdl3_revision)
unset(_cirvivor_sdl3_revision_file)
