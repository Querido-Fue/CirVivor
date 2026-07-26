include_guard(GLOBAL)

set(
    CIRVIVOR_PRETENDARD_WOFF2_SHA256
    "9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4"
)
set(
    CIRVIVOR_PRETENDARD_LICENSE_SHA256
    "dbbfd9862cc8513c40d307d892a446b33ef4767e6423a3f74a913b8a210b91fd"
)

function(cirvivor_prepare_text_assets output_font output_license)
    get_filename_component(
        _cirvivor_repository_root
        "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/../.."
        ABSOLUTE
    )
    set(
        _cirvivor_font_source
        "${_cirvivor_repository_root}/project/game/font/PretendardVariable.woff2"
    )
    set(
        _cirvivor_license_source
        "${_cirvivor_repository_root}/project/license/pretendard.txt"
    )

    foreach(_cirvivor_asset IN ITEMS _cirvivor_font_source _cirvivor_license_source)
        if(NOT EXISTS "${${_cirvivor_asset}}")
            message(FATAL_ERROR "Required text asset is missing: ${${_cirvivor_asset}}")
        endif()
    endforeach()

    file(SHA256 "${_cirvivor_font_source}" _cirvivor_font_sha256)
    if(NOT _cirvivor_font_sha256 STREQUAL CIRVIVOR_PRETENDARD_WOFF2_SHA256)
        message(FATAL_ERROR
            "PretendardVariable.woff2 hash mismatch: expected "
            "${CIRVIVOR_PRETENDARD_WOFF2_SHA256}, found ${_cirvivor_font_sha256}."
        )
    endif()

    file(SHA256 "${_cirvivor_license_source}" _cirvivor_license_sha256)
    if(NOT _cirvivor_license_sha256 STREQUAL CIRVIVOR_PRETENDARD_LICENSE_SHA256)
        message(FATAL_ERROR
            "pretendard.txt hash mismatch: expected "
            "${CIRVIVOR_PRETENDARD_LICENSE_SHA256}, found ${_cirvivor_license_sha256}."
        )
    endif()

    set(_cirvivor_asset_directory "${CMAKE_CURRENT_BINARY_DIR}/runtime_assets")
    set(_cirvivor_font_output "${_cirvivor_asset_directory}/font/PretendardVariable.woff2")
    set(_cirvivor_license_output "${_cirvivor_asset_directory}/license/pretendard.txt")
    get_filename_component(_cirvivor_font_output_directory "${_cirvivor_font_output}" DIRECTORY)
    get_filename_component(_cirvivor_license_output_directory "${_cirvivor_license_output}" DIRECTORY)
    file(MAKE_DIRECTORY
        "${_cirvivor_font_output_directory}"
        "${_cirvivor_license_output_directory}"
    )
    configure_file("${_cirvivor_font_source}" "${_cirvivor_font_output}" COPYONLY)
    configure_file("${_cirvivor_license_source}" "${_cirvivor_license_output}" COPYONLY)

    file(TO_CMAKE_PATH "${_cirvivor_font_output}" _cirvivor_font_output)
    file(TO_CMAKE_PATH "${_cirvivor_license_output}" _cirvivor_license_output)
    set(${output_font} "${_cirvivor_font_output}" PARENT_SCOPE)
    set(${output_license} "${_cirvivor_license_output}" PARENT_SCOPE)
endfunction()
