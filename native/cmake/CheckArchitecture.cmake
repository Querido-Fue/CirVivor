if(NOT DEFINED SOURCE_ROOT)
    message(FATAL_ERROR "SOURCE_ROOT is required.")
endif()

set(_cirvivor_boundary_directories
    core
    engine
    game
    render/backend
    render/common
    render/frontend
)
set(_cirvivor_violations)

foreach(_cirvivor_directory IN LISTS _cirvivor_boundary_directories)
    set(_cirvivor_root "${SOURCE_ROOT}/${_cirvivor_directory}")
    if(NOT EXISTS "${_cirvivor_root}")
        continue()
    endif()

    file(GLOB_RECURSE _cirvivor_sources
        LIST_DIRECTORIES FALSE
        "${_cirvivor_root}/*.h"
        "${_cirvivor_root}/*.hpp"
        "${_cirvivor_root}/*.inl"
        "${_cirvivor_root}/*.cc"
        "${_cirvivor_root}/*.cpp"
        "${_cirvivor_root}/*.cxx"
        "${_cirvivor_root}/*.m"
        "${_cirvivor_root}/*.mm"
    )
    foreach(_cirvivor_source IN LISTS _cirvivor_sources)
        file(READ "${_cirvivor_source}" _cirvivor_contents)
        string(REGEX MATCH
            "#[ \t]*include[ \t]*[<\"]SDL3/|(^|[^A-Za-z0-9_])SDL_[A-Za-z0-9_]+"
            _cirvivor_match
            "${_cirvivor_contents}"
        )
        if(_cirvivor_match)
            file(RELATIVE_PATH _cirvivor_relative "${SOURCE_ROOT}" "${_cirvivor_source}")
            list(APPEND _cirvivor_violations "${_cirvivor_relative}")
        endif()
    endforeach()
endforeach()

if(_cirvivor_violations)
    list(JOIN _cirvivor_violations ", " _cirvivor_violation_text)
    message(FATAL_ERROR
        "SDL dependency crossed a platform boundary: ${_cirvivor_violation_text}"
    )
endif()

message(STATUS "Native architecture boundary check passed.")
