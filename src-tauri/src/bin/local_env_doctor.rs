fn main() {
    std::process::exit(correo_boxplot_lib::run_local_env_doctor(
        std::env::args().skip(1),
    ));
}
