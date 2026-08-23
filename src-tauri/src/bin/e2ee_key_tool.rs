fn main() {
    std::process::exit(correo_boxplot_lib::run_e2ee_key_tool(
        std::env::args().skip(1),
    ));
}
