# ---------------------------------------------------------------------------
# Unit tests (doctest). Built only when LIVEPLAY_BUILD_TESTS=ON (see the parent
# CMakeLists). Each source-under-test is compiled directly into the test binary
# so tests don't depend on the full server executable / its heavy deps (Crow,
# miniaudio, TagLib). Keep this list to genuinely self-contained TUs.
# ---------------------------------------------------------------------------
find_package(doctest CONFIG REQUIRED)

add_executable(liveplay-tests
    test_main.cpp
    test_ltc_generator.cpp
    test_fs_sandbox.cpp
    test_osc_client.cpp   # header-only OSC encoder — no extra TU / socket libs needed
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/audio/ltc_generator.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/util/fs_sandbox.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/logger.cpp   # fs_sandbox.cpp logs via Logger
)

target_include_directories(liveplay-tests
    PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../include
)

target_link_libraries(liveplay-tests
    PRIVATE
        doctest::doctest
        Threads::Threads
)

if(WIN32)
    # fs_sandbox.cpp uses SHGetKnownFolderPath / CoTaskMemFree for the default roots.
    target_link_libraries(liveplay-tests PRIVATE shell32 ole32)
    target_compile_definitions(liveplay-tests PRIVATE UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
endif()

add_test(NAME liveplay-unit-tests COMMAND liveplay-tests)
