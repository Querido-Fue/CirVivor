cmake_minimum_required(VERSION 3.25)

project(CirVivorNative VERSION 0.1.0 LANGUAGES C CXX)

include(CTest)

option(CIRVIVOR_WARNINGS_AS_ERRORS "Treat compiler warnings as errors." ON)
option(CIRVIVOR_ENABLE_SANITIZERS "Enable AddressSanitizer and UndefinedBehaviorSanitizer when supported." OFF)
option(CIRVIVOR_BUILD_SDL_APP "Build the SDL3 desktop application shell." ON)
option(CIRVIVOR_BUILD_TEXT_STACK "Build the pinned FreeType and HarfBuzz text stack." ON)

if(CIRVIVOR_BUILD_SDL_APP AND NOT CIRVIVOR_BUILD_TEXT_STACK)
    message(FATAL_ERROR "The SDL desktop application requires CIRVIVOR_BUILD_TEXT_STACK=ON.")
endif()

function(cirvivor_configure_target target_name)
    target_compile_features(${target_name} PUBLIC cxx_std_20)
    set_target_properties(${target_name} PROPERTIES
        CXX_EXTENSIONS OFF
        CXX_STANDARD_REQUIRED ON
    )

    if(MSVC)
        target_compile_options(${target_name} PRIVATE
            /W4
            /permissive-
            /utf-8
            /Zc:__cplusplus
        )
        if(CIRVIVOR_WARNINGS_AS_ERRORS)
            target_compile_options(${target_name} PRIVATE /WX)
        endif()
    else()
        target_compile_options(${target_name} PRIVATE
            -Wall
            -Wextra
            -Wpedantic
            -Wconversion
            -Wshadow
            -Wsign-conversion
        )
        if(CIRVIVOR_WARNINGS_AS_ERRORS)
            target_compile_options(${target_name} PRIVATE -Werror)
        endif()
    endif()

    if(CIRVIVOR_ENABLE_SANITIZERS)
        if(MSVC)
            target_compile_options(${target_name} PRIVATE /fsanitize=address)
            target_link_options(${target_name} PRIVATE /fsanitize=address)
        elseif(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
            target_compile_options(${target_name} PRIVATE
                -fsanitize=address,undefined
                -fno-omit-frame-pointer
            )
            target_link_options(${target_name} PRIVATE
                -fsanitize=address,undefined
                -fno-omit-frame-pointer
            )
        else()
            message(FATAL_ERROR "CIRVIVOR_ENABLE_SANITIZERS is not supported by ${CMAKE_CXX_COMPILER_ID}.")
        endif()
    endif()
endfunction()

add_library(game_core STATIC
    src/core/math/deterministic_math.cpp
    src/core/navigation/flow_field_scalar.cpp
    src/core/physics/body_soa.cpp
    src/core/physics/collision_candidate_builder.cpp
    src/core/physics/collision_narrowphase.cpp
    src/core/physics/collision_spatial_grid.cpp
    src/core/physics/prepared_contact_scalar.cpp
    src/core/physics/tile_collision_solver.cpp
    src/core/rng/deterministic_rng.cpp
    src/core/state_hash/canonical_state_hasher.cpp
    src/core/state_hash/state_hasher.cpp
    src/core/world/tile_map.cpp
    src/engine/frame_scheduler.cpp
    src/game/game_system.cpp
)
target_include_directories(game_core PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
cirvivor_configure_target(game_core)

add_library(app_runtime STATIC
    src/app/movement_input_buffer.cpp
    src/app/title_display_policy.cpp
)
target_include_directories(app_runtime PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
target_link_libraries(app_runtime PUBLIC game_core)
cirvivor_configure_target(app_runtime)

add_library(ui_runtime STATIC
    src/ui/layout/ui_layout_metrics.cpp
    src/ui/title_overlay_content.cpp
    src/ui/title_overlay_state_machine.cpp
    src/ui/title_ui_controller.cpp
)
target_include_directories(ui_runtime PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
cirvivor_configure_target(ui_runtime)

add_library(settings_runtime STATIC
    src/settings/settings_codec.cpp
    src/settings/settings_model.cpp
    src/settings/settings_overlay_session.cpp
    src/settings/settings_repository.cpp
)
target_include_directories(settings_runtime PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
cirvivor_configure_target(settings_runtime)

add_library(debug_runtime STATIC
    src/debug/debug_runtime_controller.cpp
)
target_include_directories(debug_runtime PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
cirvivor_configure_target(debug_runtime)

if(MSVC)
    set_source_files_properties(
        src/core/math/deterministic_math.cpp
        src/core/navigation/flow_field_scalar.cpp
        src/core/physics/collision_candidate_builder.cpp
        src/core/physics/collision_narrowphase.cpp
        src/core/physics/collision_spatial_grid.cpp
        src/core/physics/prepared_contact_scalar.cpp
        PROPERTIES COMPILE_OPTIONS "/fp:strict"
    )
else()
    set_source_files_properties(
        src/core/math/deterministic_math.cpp
        src/core/navigation/flow_field_scalar.cpp
        src/core/physics/collision_candidate_builder.cpp
        src/core/physics/collision_narrowphase.cpp
        src/core/physics/collision_spatial_grid.cpp
        src/core/physics/prepared_contact_scalar.cpp
        PROPERTIES COMPILE_OPTIONS "-ffp-contract=off"
    )
endif()

add_library(renderer_common STATIC
    src/render/common/frame_packet.cpp
    src/render/common/frame_packet_codec.cpp
)
target_include_directories(renderer_common PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
cirvivor_configure_target(renderer_common)

if(CIRVIVOR_BUILD_TEXT_STACK)
    include(cmake/TextDependencies.cmake)
    include(cmake/TextAssets.cmake)
    cirvivor_prepare_text_assets(
        CIRVIVOR_PRETENDARD_FONT_ASSET
        CIRVIVOR_PRETENDARD_LICENSE_ASSET
    )

    add_library(render_text STATIC
        src/render/text/font_face.cpp
        src/render/text/glyph_atlas.cpp
        src/render/text/shaped_text_cache.cpp
    )
    target_include_directories(render_text PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
    target_link_libraries(render_text PRIVATE freetype harfbuzz)
    cirvivor_configure_target(render_text)
endif()

add_library(render_frontend STATIC
    src/render/frontend/frame_packet_builder.cpp
    src/render/frontend/playable_game_scene.cpp
    src/render/frontend/synthetic_test_scene.cpp
    src/render/frontend/title_overlay_presenter.cpp
    src/render/frontend/title_scene.cpp
)
target_include_directories(render_frontend PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
target_link_libraries(render_frontend PUBLIC game_core renderer_common ui_runtime)
cirvivor_configure_target(render_frontend)

add_library(renderer_backend STATIC
    src/render/backend/renderer_router.cpp
)
target_include_directories(renderer_backend PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
target_link_libraries(renderer_backend PUBLIC renderer_common)
cirvivor_configure_target(renderer_backend)

add_executable(game_headless
    src/headless/main.cpp
)
target_link_libraries(game_headless PRIVATE game_core)
cirvivor_configure_target(game_headless)

if(BUILD_TESTING)
    add_executable(game_tests
        tests/test_main.cpp
    )
    target_link_libraries(game_tests PRIVATE game_core)
    cirvivor_configure_target(game_tests)

    add_executable(frame_packet_tests
        tests/frame_packet_test.cpp
    )
    target_link_libraries(frame_packet_tests PRIVATE render_frontend renderer_common)
    cirvivor_configure_target(frame_packet_tests)

    add_executable(gles_backend_tests
        tests/gles_backend_test.cpp
    )
    target_link_libraries(gles_backend_tests PRIVATE render_frontend renderer_common)
    cirvivor_configure_target(gles_backend_tests)

    add_executable(playable_game_scene_tests
        tests/playable_game_scene_test.cpp
    )
    target_link_libraries(playable_game_scene_tests PRIVATE render_frontend game_core)
    cirvivor_configure_target(playable_game_scene_tests)

    add_executable(title_scene_tests
        tests/title_scene_test.cpp
    )
    target_link_libraries(title_scene_tests PRIVATE render_frontend ui_runtime)
    cirvivor_configure_target(title_scene_tests)

    add_executable(movement_input_buffer_tests
        tests/movement_input_buffer_test.cpp
    )
    target_link_libraries(movement_input_buffer_tests PRIVATE app_runtime)
    cirvivor_configure_target(movement_input_buffer_tests)

    add_executable(title_display_policy_tests
        tests/title_display_policy_test.cpp
    )
    target_link_libraries(title_display_policy_tests PRIVATE app_runtime)
    cirvivor_configure_target(title_display_policy_tests)

    add_executable(title_overlay_state_machine_tests
        tests/title_overlay_state_machine_test.cpp
    )
    target_link_libraries(title_overlay_state_machine_tests PRIVATE ui_runtime)
    cirvivor_configure_target(title_overlay_state_machine_tests)

    add_executable(ui_layout_metrics_tests
        tests/ui_layout_metrics_test.cpp
    )
    target_link_libraries(ui_layout_metrics_tests PRIVATE ui_runtime)
    cirvivor_configure_target(ui_layout_metrics_tests)

    add_executable(title_ui_controller_tests
        tests/title_ui_controller_test.cpp
    )
    target_link_libraries(title_ui_controller_tests PRIVATE ui_runtime)
    cirvivor_configure_target(title_ui_controller_tests)

    add_executable(settings_codec_tests
        tests/settings_codec_test.cpp
    )
    target_link_libraries(settings_codec_tests PRIVATE settings_runtime)
    cirvivor_configure_target(settings_codec_tests)

    add_executable(settings_repository_tests
        tests/settings_repository_test.cpp
    )
    target_link_libraries(settings_repository_tests PRIVATE settings_runtime)
    cirvivor_configure_target(settings_repository_tests)

    add_executable(settings_overlay_session_tests
        tests/settings_overlay_session_test.cpp
    )
    target_link_libraries(settings_overlay_session_tests PRIVATE settings_runtime)
    cirvivor_configure_target(settings_overlay_session_tests)

    add_executable(debug_runtime_controller_tests
        tests/debug_runtime_controller_test.cpp
    )
    target_link_libraries(debug_runtime_controller_tests PRIVATE debug_runtime)
    cirvivor_configure_target(debug_runtime_controller_tests)

    add_executable(renderer_router_tests
        tests/renderer_router_test.cpp
    )
    target_link_libraries(renderer_router_tests PRIVATE renderer_backend renderer_common)
    cirvivor_configure_target(renderer_router_tests)

    add_executable(simulation_parity_tests
        tests/simulation_parity_test.cpp
    )
    target_link_libraries(simulation_parity_tests PRIVATE game_core)
    cirvivor_configure_target(simulation_parity_tests)

    add_executable(game_replay_parity_tests
        tests/game_replay_parity_test.cpp
    )
    target_link_libraries(game_replay_parity_tests PRIVATE game_core)
    cirvivor_configure_target(game_replay_parity_tests)

    add_executable(wat_scalar_parity_tests
        tests/wat_scalar_parity_test.cpp
    )
    target_link_libraries(wat_scalar_parity_tests PRIVATE game_core)
    cirvivor_configure_target(wat_scalar_parity_tests)

    add_executable(legacy_collision_broadphase_parity_tests
        tests/legacy_collision_broadphase_parity_test.cpp
    )
    target_link_libraries(legacy_collision_broadphase_parity_tests PRIVATE game_core)
    cirvivor_configure_target(legacy_collision_broadphase_parity_tests)

    add_executable(legacy_collision_narrowphase_parity_tests
        tests/legacy_collision_narrowphase_parity_test.cpp
    )
    target_link_libraries(legacy_collision_narrowphase_parity_tests PRIVATE game_core)
    cirvivor_configure_target(legacy_collision_narrowphase_parity_tests)

    if(CIRVIVOR_BUILD_TEXT_STACK)
        add_executable(font_stack_tests
            tests/font_stack_test.cpp
        )
        target_link_libraries(font_stack_tests PRIVATE render_text)
        target_compile_definitions(
            font_stack_tests
            PRIVATE
                CIRVIVOR_PRETENDARD_FONT_PATH="${CIRVIVOR_PRETENDARD_FONT_ASSET}"
                CIRVIVOR_PRETENDARD_LICENSE_PATH="${CIRVIVOR_PRETENDARD_LICENSE_ASSET}"
        )
        cirvivor_configure_target(font_stack_tests)
    endif()

    add_test(NAME game_tests COMMAND game_tests)
    add_test(NAME frame_packet_tests COMMAND frame_packet_tests)
    add_test(NAME gles_backend_tests COMMAND gles_backend_tests)
    add_test(NAME playable_game_scene_tests COMMAND playable_game_scene_tests)
    add_test(NAME title_scene_tests COMMAND title_scene_tests)
    add_test(NAME movement_input_buffer_tests COMMAND movement_input_buffer_tests)
    add_test(NAME title_display_policy_tests COMMAND title_display_policy_tests)
    add_test(
        NAME title_overlay_state_machine_tests
        COMMAND title_overlay_state_machine_tests
    )
    add_test(NAME ui_layout_metrics_tests COMMAND ui_layout_metrics_tests)
    add_test(NAME title_ui_controller_tests COMMAND title_ui_controller_tests)
    add_test(NAME settings_codec_tests COMMAND settings_codec_tests)
    add_test(NAME settings_repository_tests COMMAND settings_repository_tests)
    add_test(NAME settings_overlay_session_tests COMMAND settings_overlay_session_tests)
    add_test(
        NAME debug_runtime_controller_tests
        COMMAND debug_runtime_controller_tests
    )
    add_test(NAME renderer_router_tests COMMAND renderer_router_tests)
    add_test(NAME simulation_parity_tests COMMAND simulation_parity_tests)
    add_test(NAME game_replay_parity_tests COMMAND game_replay_parity_tests)
    add_test(NAME wat_scalar_parity_tests COMMAND wat_scalar_parity_tests)
    if(CIRVIVOR_BUILD_TEXT_STACK)
        add_test(NAME font_stack_tests COMMAND font_stack_tests)
    endif()
    add_test(
        NAME legacy_collision_broadphase_parity_tests
        COMMAND legacy_collision_broadphase_parity_tests
    )
    add_test(
        NAME legacy_collision_narrowphase_parity_tests
        COMMAND legacy_collision_narrowphase_parity_tests
    )
    add_test(
        NAME architecture_boundaries
        COMMAND
            "${CMAKE_COMMAND}"
            "-DSOURCE_ROOT=${CMAKE_CURRENT_SOURCE_DIR}/src"
            -P "${CMAKE_CURRENT_SOURCE_DIR}/cmake/CheckArchitecture.cmake"
    )
endif()

if(CIRVIVOR_BUILD_SDL_APP)
    include(cmake/Dependencies.cmake)

    add_library(renderer_sdl_gpu STATIC
        src/render/sdl_gpu/sdl_gpu_backend.cpp
    )
    target_include_directories(renderer_sdl_gpu PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
    target_link_libraries(renderer_sdl_gpu PUBLIC renderer_common SDL3::SDL3)
    cirvivor_configure_target(renderer_sdl_gpu)

    add_library(renderer_gles STATIC
        src/render/gles/gles_backend.cpp
    )
    target_include_directories(renderer_gles PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
    target_link_libraries(renderer_gles PUBLIC renderer_common SDL3::SDL3)
    cirvivor_configure_target(renderer_gles)

    add_library(renderer_software STATIC
        src/render/software/software_backend.cpp
        src/render/software/software_rasterizer.cpp
        src/render/software/software_renderer.cpp
    )
    target_include_directories(renderer_software PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
    target_link_libraries(renderer_software PUBLIC renderer_common SDL3::SDL3)
    cirvivor_configure_target(renderer_software)

    add_library(platform_sdl STATIC
        src/platform/sdl/audio/sdl_playback_device.cpp
        src/platform/sdl/sdl_lifecycle.cpp
        src/platform/sdl/sdl_platform_event.cpp
        src/platform/sdl/sdl_runtime_asset.cpp
        src/platform/sdl/storage/sdl_settings_storage.cpp
        src/platform/sdl/storage/sdl_user_storage.cpp
        src/platform/sdl/sdl_window.cpp
    )
    target_include_directories(platform_sdl PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
    target_link_libraries(platform_sdl PRIVATE settings_runtime SDL3::SDL3)
    cirvivor_configure_target(platform_sdl)

    add_executable(game_desktop
        src/app/application.cpp
        src/app/sdl_app.cpp
    )
    target_link_libraries(
        game_desktop
        PRIVATE
            game_core
            app_runtime
            debug_runtime
            settings_runtime
            ui_runtime
            platform_sdl
            render_frontend
            renderer_backend
            renderer_gles
            renderer_sdl_gpu
            renderer_software
            render_text
            SDL3::SDL3
    )
    cirvivor_configure_target(game_desktop)

    add_custom_command(
        TARGET game_desktop POST_BUILD
        COMMAND "${CMAKE_COMMAND}" -E make_directory
            "$<TARGET_FILE_DIR:game_desktop>/runtime_assets/font"
            "$<TARGET_FILE_DIR:game_desktop>/runtime_assets/license"
        COMMAND "${CMAKE_COMMAND}" -E copy_if_different
            "${CIRVIVOR_PRETENDARD_FONT_ASSET}"
            "$<TARGET_FILE_DIR:game_desktop>/runtime_assets/font/PretendardVariable.woff2"
        COMMAND "${CMAKE_COMMAND}" -E copy_if_different
            "${CIRVIVOR_PRETENDARD_LICENSE_ASSET}"
            "$<TARGET_FILE_DIR:game_desktop>/runtime_assets/license/pretendard.txt"
        VERBATIM
    )

    if(BUILD_TESTING)
        add_executable(sdl_platform_event_tests
            tests/sdl_platform_event_test.cpp
        )
        target_link_libraries(sdl_platform_event_tests PRIVATE platform_sdl SDL3::SDL3)
        cirvivor_configure_target(sdl_platform_event_tests)

        add_executable(sdl_settings_storage_tests
            tests/sdl_settings_storage_test.cpp
        )
        target_link_libraries(
            sdl_settings_storage_tests
            PRIVATE platform_sdl settings_runtime SDL3::SDL3
        )
        cirvivor_configure_target(sdl_settings_storage_tests)

        add_executable(application_integration_smoke_tests
            tests/application_integration_smoke_test.cpp
            src/app/application.cpp
        )
        target_link_libraries(
            application_integration_smoke_tests
            PRIVATE
                game_core
                app_runtime
                debug_runtime
                settings_runtime
                ui_runtime
                platform_sdl
                render_frontend
                renderer_backend
                renderer_gles
                renderer_sdl_gpu
                renderer_software
                render_text
                SDL3::SDL3
        )
        cirvivor_configure_target(application_integration_smoke_tests)
        add_custom_command(
            TARGET application_integration_smoke_tests POST_BUILD
            COMMAND "${CMAKE_COMMAND}" -E make_directory
                "$<TARGET_FILE_DIR:application_integration_smoke_tests>/runtime_assets/font"
                "$<TARGET_FILE_DIR:application_integration_smoke_tests>/runtime_assets/license"
            COMMAND "${CMAKE_COMMAND}" -E copy_if_different
                "${CIRVIVOR_PRETENDARD_FONT_ASSET}"
                "$<TARGET_FILE_DIR:application_integration_smoke_tests>/runtime_assets/font/PretendardVariable.woff2"
            COMMAND "${CMAKE_COMMAND}" -E copy_if_different
                "${CIRVIVOR_PRETENDARD_LICENSE_ASSET}"
                "$<TARGET_FILE_DIR:application_integration_smoke_tests>/runtime_assets/license/pretendard.txt"
            VERBATIM
        )

        add_executable(software_renderer_tests
            tests/software_renderer_test.cpp
        )
        target_link_libraries(
            software_renderer_tests
            PRIVATE render_frontend renderer_software
        )
        cirvivor_configure_target(software_renderer_tests)

        add_executable(software_renderer_benchmark
            tests/software_renderer_benchmark.cpp
        )
        target_link_libraries(
            software_renderer_benchmark
            PRIVATE render_frontend renderer_software
        )
        cirvivor_configure_target(software_renderer_benchmark)

        add_test(NAME sdl_platform_event_tests COMMAND sdl_platform_event_tests)
        add_test(NAME sdl_settings_storage_tests COMMAND sdl_settings_storage_tests)
        add_test(
            NAME application_integration_smoke_tests
            COMMAND application_integration_smoke_tests
        )
        add_test(NAME software_renderer_tests COMMAND software_renderer_tests)
        add_test(NAME game_desktop_smoke COMMAND game_desktop --smoke-test)
        add_test(
            NAME game_desktop_software_smoke
            COMMAND game_desktop --smoke-test --renderer software
        )
        add_test(
            NAME game_desktop_title_smoke
            COMMAND game_desktop --smoke-test-title --renderer software
        )
        add_test(
            NAME game_desktop_title_to_playable_smoke
            COMMAND game_desktop --smoke-test-title-to-playable
        )
        add_test(
            NAME game_desktop_title_to_playable_software_smoke
            COMMAND game_desktop --smoke-test-title-to-playable --renderer software
        )
        add_test(
            NAME game_desktop_cli_last_playable_scene_smoke
            COMMAND game_desktop
                --smoke-test-title-to-playable
                --playable-scene
                --renderer software
        )
        add_test(
            NAME game_desktop_cli_last_title_transition_smoke
            COMMAND game_desktop
                --playable-scene
                --smoke-test-title-to-playable
                --renderer software
        )
        add_test(
            NAME game_desktop_render_recovery_smoke
            COMMAND game_desktop --smoke-test-render-recovery
        )
        set_tests_properties(
            sdl_settings_storage_tests
            PROPERTIES
            RESOURCE_LOCK cirvivor_settings_storage_test
            TIMEOUT 15
        )
        set_tests_properties(
            game_desktop_smoke
            game_desktop_software_smoke
            game_desktop_title_smoke
            game_desktop_title_to_playable_smoke
            game_desktop_title_to_playable_software_smoke
            game_desktop_cli_last_playable_scene_smoke
            game_desktop_cli_last_title_transition_smoke
            game_desktop_render_recovery_smoke
            application_integration_smoke_tests
            PROPERTIES
            ENVIRONMENT "SDL_AUDIODRIVER=dummy;SDL_VIDEODRIVER=dummy;SDL_RENDER_DRIVER=software"
            RESOURCE_LOCK cirvivor_user_storage_smoke
            TIMEOUT 15
        )
        set_tests_properties(
            game_desktop_cli_last_playable_scene_smoke
            PROPERTIES
            FAIL_REGULAR_EXPRESSION
                "Title, map-select shell, and playable frames rendered successfully"
        )
        set_tests_properties(
            game_desktop_cli_last_title_transition_smoke
            PROPERTIES
            FAIL_REGULAR_EXPRESSION "scene playable"
        )
    endif()
endif()
