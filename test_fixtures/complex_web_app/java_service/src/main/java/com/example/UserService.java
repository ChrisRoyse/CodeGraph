package com.example;

public class UserService {
    public String getUserData(int userId) {
        // Simulate fetching user data
        System.out.println("Fetching data for user ID: " + userId + " in Java service");
        return "{\"userId\": " + userId + ", \"name\": \"Java User\"}";
    }
}