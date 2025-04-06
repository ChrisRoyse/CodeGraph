package com.example;

public class ApiService {
    private UserService userService = new UserService();

    public void handleUserRequest(int id) {
        String userData = userService.getUserData(id);
        System.out.println("Java ApiService processed: " + userData);
        // Simulate interaction point, maybe log or prepare data
    }

    public static void main(String[] args) {
        ApiService api = new ApiService();
        api.handleUserRequest(123);
    }
}